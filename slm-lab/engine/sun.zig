// sun.zig — SmolLM2-135M decoder on a repacked Q8 + AVX-512 VNNI kernel.
const std = @import("std");
const linux = std.os.linux;

const L = 30;
const D = 576;
const H = 9;
const KVH = 3;
const HD = 64;
const F = 1536;
const V = 49152;
const MAXT = 1024;
const THETA: f32 = 100000.0;
const EPS: f32 = 1e-5;
const NT = 2; // threads

const V64u = @Vector(64, u8);
const V64i = @Vector(64, i8);
const V16i = @Vector(16, i32);
const V16f = @Vector(16, f32);

fn now() f64 {
    var ts: linux.timespec = undefined;
    _ = linux.clock_gettime(.MONOTONIC, &ts);
    return @as(f64, @floatFromInt(ts.sec)) + @as(f64, @floatFromInt(ts.nsec)) * 1e-9;
}

inline fn dpbusd(acc: V16i, a: V64u, b: V64i) V16i {
    return asm ("vpdpbusd %[b], %[a], %[acc]"
        : [acc] "=v" (-> V16i),
        : [acc_in] "0" (acc),
          [a] "v" (a),
          [b] "v" (b),
    );
}

// ---------------- weights ----------------
const Q8 = struct {
    q: [*]const V64u, // rows * K/64
    d: [*]const f16, // rows * K/32
    rows: usize,
    inv: ?[*]const f32 = null, // non-null => Q4 (nibble pairs) with activation scale 1/s
    k: usize,
};
const Layer = struct { an: [*]const f32, wq: Q8, wk: Q8, wv: Q8, wo: Q8, fn_: [*]const f32, wg: Q8, wu: Q8, wd: Q8 };

var base: [*]const u8 = undefined;
var off: usize = 0;
fn take(n: usize) [*]const u8 {
    const p = base + off;
    off += (n + 63) & ~@as(usize, 63);
    return p;
}
fn tq8(rows: usize, k: usize) Q8 {
    const q: [*]const V64u = @ptrCast(@alignCast(take(rows * k)));
    const d: [*]const f16 = @ptrCast(@alignCast(take(rows * k / 32 * 2)));
    return .{ .q = q, .d = d, .rows = rows, .k = k };
}
fn tq4(rows: usize, k: usize) Q8 {
    const q: [*]const V64u = @ptrCast(@alignCast(take(rows * k / 2)));
    const d: [*]const f16 = @ptrCast(@alignCast(take(rows * k / 32 * 2)));
    const inv: [*]const f32 = @ptrCast(@alignCast(take(k * 4)));
    return .{ .q = q, .d = d, .rows = rows, .k = k, .inv = inv };
}
fn tf32(n: usize) [*]const f32 {
    return @ptrCast(@alignCast(take(n * 4)));
}

var emb: Q8 = undefined;
var layers: [L]Layer = undefined;
var onorm: [*]const f32 = undefined;

// ---------------- quantized activation ----------------
const XQ = struct {
    q: [F / 64]V64i align(64) = undefined,
    bias: [F / 64]V16i = undefined,
    bias8: [F / 64]V16i = undefined,
    xs: [F / 64]V16f = undefined,
};

fn quant(x: []const f32, out: *XQ) void {
    const pairs = x.len / 64;
    for (0..pairs) |p| {
        var qb: [64]i8 = undefined;
        inline for (0..2) |h| {
            const blk = x[p * 64 + h * 32 ..][0..32];
            const v: @Vector(32, f32) = blk.*;
            const amax = @reduce(.Max, @abs(v));
            const dd: f32 = amax / 127.0;
            const inv: f32 = if (dd > 0) 1.0 / dd else 0;
            const r = @round(v * @as(@Vector(32, f32), @splat(inv)));
            const qi: @Vector(32, i8) = @intFromFloat(r);
            qb[h * 32 ..][0..32].* = qi;
            const s: i32 = @reduce(.Add, @as(@Vector(32, i32), qi));
            out.bias[p][h * 8] = -128 * s;
            out.bias8[p][h * 8] = -8 * s;
            inline for (1..8) |l| out.bias8[p][h * 8 + l] = 0;
            inline for (1..8) |l| out.bias[p][h * 8 + l] = 0;
            inline for (0..8) |l| out.xs[p][h * 8 + l] = dd;
        }
        out.q[p] = qb;
    }
}

fn matvecRows4(w: Q8, x: *const XQ, y: [*]f32, r0: usize, r1: usize) void {
    const m4: @Vector(32, u8) = @splat(0x0F);
    const idx = comptime blk: {
        var a: [64]i32 = undefined;
        for (0..32) |i| {
            a[i] = i;
            a[32 + i] = ~@as(i32, i);
        }
        break :blk a;
    };
    const lo8 = @Vector(16, i32){ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1 };
    const ppr = w.k / 64;
    const bpr = w.k / 32;
    const Q: [*]const @Vector(32, u8) = @ptrCast(w.q);
    var r = r0;
    while (r < r1) : (r += 1) {
        if (r + 16 < r1) {
            const pp: [*]const u8 = @ptrCast(Q + (r + 16) * ppr);
            var c: usize = 0;
            while (c < w.k / 2) : (c += 64) @prefetch(pp + c, .{});
        }
        const q = Q + r * ppr;
        const d = w.d + r * bpr;
        var acc: V16f = @splat(0);
        for (0..ppr) |p| {
            const w4 = q[p];
            const wu: V64u = @shuffle(u8, w4 & m4, w4 >> @splat(4), idx);
            const s = dpbusd(x.bias8[p], wu, x.q[p]);
            const s2: @Vector(2, f32) = @floatCast(@as(@Vector(2, f16), d[2 * p ..][0..2].*));
            const scl = @shuffle(f32, s2, undefined, lo8) * x.xs[p];
            acc = @mulAdd(V16f, @floatFromInt(s), scl, acc);
        }
        y[r] = @reduce(.Add, acc);
    }
}

fn matvecRows(w: Q8, x: *const XQ, y: [*]f32, r0: usize, r1: usize) void {
    if (w.inv != null) return matvecRows4(w, x, y, r0, r1);
    const flip: V64u = @splat(0x80);
    const lo8 = @Vector(16, i32){ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1 };
    const ppr = w.k / 64;
    const bpr = w.k / 32;
    var r = r0;
    while (r < r1) : (r += 1) {
        if (r + 16 < r1) {
            const pp: [*]const u8 = @ptrCast(w.q + (r + 16) * ppr);
            var c: usize = 0;
            while (c < w.k) : (c += 64) @prefetch(pp + c, .{});
        }
        const q = w.q + r * ppr;
        const d = w.d + r * bpr;
        var acc: V16f = @splat(0);
        for (0..ppr) |p| {
            const s = dpbusd(x.bias[p], q[p] ^ flip, x.q[p]);
            const s2: @Vector(2, f32) = @floatCast(@as(@Vector(2, f16), d[2 * p ..][0..2].*));
            const scl = @shuffle(f32, s2, undefined, lo8) * x.xs[p];
            acc = @mulAdd(V16f, @floatFromInt(s), scl, acc);
        }
        y[r] = @reduce(.Add, acc);
    }
}

// ---------------- spin thread pool ----------------
const Job = struct { attn: bool = false, al: usize = 0, aT: usize = 0, n: usize = 0, w: [3]Q8 = undefined, y: [3][*]f32 = undefined, xs: [3]*const XQ = undefined };
var job: Job = .{};
var gen = std.atomic.Value(u32).init(0);
var done = std.atomic.Value(u32).init(0);
var quit = std.atomic.Value(bool).init(false);

fn runShare(tid: usize) void {
    if (job.attn) return attnPart(tid);
    for (0..job.n) |j| {
        const rows = job.w[j].rows;
        const chunk = (rows / NT + 15) & ~@as(usize, 15);
        const r0 = @min(rows, tid * chunk);
        const r1 = if (tid == NT - 1) rows else @min(rows, (tid + 1) * chunk);
        matvecRows(job.w[j], job.xs[j], job.y[j], r0, r1);
    }
}
fn worker(tid: usize) void {
    var seen: u32 = 0;
    while (true) {
        while (gen.load(.acquire) == seen) {
            if (quit.load(.monotonic)) return;
            std.atomic.spinLoopHint();
        }
        seen +%= 1;
        runShare(tid);
        _ = done.fetchAdd(1, .release);
    }
}
var t_mv: f64 = 0;
var xq4: [3]XQ = .{ .{}, .{}, .{} };
var xsc: [F]f32 = undefined;
fn dispatch(src: []const f32, ws: []const Q8, ys: []const [*]f32) void {
    const ts = now();
    defer t_mv += now() - ts;
    var plain = false;
    for (ws, 0..) |w, i| {
        if (w.inv) |inv| {
            if (i > 0 and ws[i - 1].inv == w.inv) { // same activation scales: reuse quantized x
                job.xs[i] = job.xs[i - 1];
                continue;
            }
            for (src, 0..) |v, j| xsc[j] = v * inv[j];
            quant(xsc[0..src.len], &xq4[i]);
            job.xs[i] = &xq4[i];
        } else {
            if (!plain) quant(src, &xq);
            plain = true;
            job.xs[i] = &xq;
        }
    }
    job.n = ws.len;
    for (ws, ys, 0..) |w, y, i| {
        job.w[i] = w;
        job.y[i] = y;
    }
    done.store(0, .monotonic);
    _ = gen.fetchAdd(1, .release);
    runShare(0);
    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
}

// ---------------- vector exp ----------------
fn vexp(xin: V16f) V16f {
    const x = @min(@max(xin, @as(V16f, @splat(-87.0))), @as(V16f, @splat(88.0)));
    const n = @round(x * @as(V16f, @splat(1.44269504088896341)));
    const r = x - n * @as(V16f, @splat(0.693359375)) + n * @as(V16f, @splat(2.12194440e-4));
    var p: V16f = @splat(1.9875691500e-4);
    p = p * r + @as(V16f, @splat(1.3981999507e-3));
    p = p * r + @as(V16f, @splat(8.3334519073e-3));
    p = p * r + @as(V16f, @splat(4.1665795894e-2));
    p = p * r + @as(V16f, @splat(1.6666665459e-1));
    p = p * r + @as(V16f, @splat(5.0000001201e-1));
    p = p * r * r + r + @as(V16f, @splat(1.0));
    const ni: V16i = @intFromFloat(n);
    const e: V16i = (ni + @as(V16i, @splat(127))) << @splat(23);
    return p * @as(V16f, @bitCast(e));
}

// ---------------- model ----------------
var kc: []f16 = undefined; // [L][MAXT][KVH*HD]
var vc: []f16 = undefined;
const V16h = @Vector(16, f16);

// flash-decoding partials: each thread covers a slice of [0,T) for all heads
var pm: [NT][H]f32 = undefined;
var pl: [NT][H]f32 = undefined;
var po: [NT][H][4]V16f = undefined;
var psc: [NT][H / KVH][MAXT + 16]f32 = undefined;

fn attnPart(tid: usize) void {
    const T = job.aT;
    const l = job.al;
    const B = (T + 15) / 16; // 16-position tiles, split across threads
    const b0 = B * tid / NT;
    const t0 = b0 * 16;
    const t1 = @min(T, (B * (tid + 1) / NT) * 16);
    const n = if (t1 > t0) t1 - t0 else 0;
    const G = H / KVH; // query heads per KV group
    for (0..KVH) |gi| {
        var q: [G][4]V16f = undefined;
        inline for (0..G) |j| q[j] = @bitCast(qv[(gi * G + j) * HD ..][0..HD].*);
        var mx: [G]f32 = @splat(-std.math.inf(f32));
        const sc_ = &psc[tid];
        var bb: usize = 0;
        while (bb * 16 < n) : (bb += 1) {
            // K tile layout [L][KVH][MAXT/16][HD][16]: 16 scores per FMA, no horizontal reduce
            const kt: [*]const V16h = @ptrCast(@alignCast(kc.ptr + ((l * KVH + gi) * (MAXT / 16) + b0 + bb) * HD * 16));
            var acc: [G]V16f = @splat(@splat(0));
            for (0..HD) |d| {
                const kd: V16f = @floatCast(kt[d]);
                inline for (0..G) |j| acc[j] = @mulAdd(V16f, @splat(qv[(gi * G + j) * HD + d]), kd, acc[j]);
            }
            const lane = std.simd.iota(u32, 16) + @as(@Vector(16, u32), @splat(@intCast(bb * 16)));
            const valid = lane < @as(@Vector(16, u32), @splat(@intCast(n)));
            inline for (0..G) |j| {
                const v = @select(f32, valid, acc[j] * @as(V16f, @splat(0.125)), @as(V16f, @splat(-std.math.inf(f32))));
                sc_[j][bb * 16 ..][0..16].* = v;
                mx[j] = @max(mx[j], @reduce(.Max, v));
            }
        }
        var sum: [G]f32 = @splat(0);
        inline for (0..G) |j| {
            var b: usize = 0;
            while (b < n) : (b += 16) {
                const lane = std.simd.iota(u32, 16) + @as(@Vector(16, u32), @splat(@intCast(b)));
                const v = @select(f32, lane < @as(@Vector(16, u32), @splat(@intCast(n))), vexp(@as(V16f, sc_[j][b..][0..16].*) - @as(V16f, @splat(mx[j]))), @as(V16f, @splat(0)));
                sc_[j][b..][0..16].* = v;
                sum[j] += @reduce(.Add, v);
            }
        }
        var o: [G][4]V16f = @splat(.{ @splat(0), @splat(0), @splat(0), @splat(0) });
        for (0..n) |i| {
            const vh: *const [4]V16h = @ptrCast(@alignCast(vc.ptr + ((l * KVH + gi) * MAXT + t0 + i) * HD));
            var v: [4]V16f = undefined;
            inline for (0..4) |c| v[c] = @floatCast(vh[c]);
            inline for (0..G) |j| {
                const a: V16f = @splat(sc_[j][i]);
                inline for (0..4) |c| o[j][c] = @mulAdd(V16f, a, v[c], o[j][c]);
            }
        }
        inline for (0..G) |j| {
            pm[tid][gi * G + j] = mx[j];
            pl[tid][gi * G + j] = sum[j];
            po[tid][gi * G + j] = o[j];
        }
    }
}

fn rmsnorm(o: []f32, x: []const f32, w: [*]const f32) void {
    var ss: f32 = 0;
    for (x) |v| ss += v * v;
    const s = 1.0 / @sqrt(ss / @as(f32, @floatFromInt(x.len)) + EPS);
    for (o, x, 0..) |*a, b, i| a.* = b * s * w[i];
}
var rc: [HD / 2]f32 = undefined;
var rs: [HD / 2]f32 = undefined;
fn ropeTable(pos: usize) void {
    for (0..HD / 2) |i| {
        const f = @as(f32, @floatFromInt(pos)) * std.math.pow(f32, THETA, -@as(f32, @floatFromInt(2 * i)) / HD);
        rc[i] = @cos(f);
        rs[i] = @sin(f);
    }
}
fn rope(v: []f32) void {
    var h: usize = 0;
    while (h < v.len) : (h += HD) {
        for (0..HD / 2) |i| {
            const c = rc[i];
            const s = rs[i];
            const a = v[h + 2 * i];
            const b = v[h + 2 * i + 1];
            v[h + 2 * i] = a * c - b * s;
            v[h + 2 * i + 1] = a * s + b * c;
        }
    }
}

var xq: XQ = .{};
var xr: [D]f32 = undefined;
var hb: [D]f32 = undefined;
var qv: [D]f32 = undefined;
var kv: [KVH * HD]f32 = undefined;
var vv: [KVH * HD]f32 = undefined;
var att: [D]f32 = undefined;
var tmp: [D]f32 = undefined;
var g: [F]f32 = undefined;
var u: [F]f32 = undefined;
var sc: [MAXT + 16]f32 = undefined;
var logits: [V]f32 = undefined;

fn forward(tok: usize, pos: usize) void {
    // embedding: dequant row
    {
        const row: [*]const i8 = @ptrCast(emb.q + tok * (D / 64));
        for (0..D) |i| xr[i] = @as(f32, @floatFromInt(row[i])) * @as(f32, emb.d[tok * (D / 32) + i / 32]);
    }
    ropeTable(pos);
    for (&layers, 0..) |*w, l| {
        rmsnorm(&hb, &xr, w.an);
        dispatch(&hb, &.{ w.wq, w.wk, w.wv }, &.{ &qv, &kv, &vv });
        rope(&qv);
        rope(&kv);
        for (0..KVH) |gi| { // KV layout [L][KVH][MAXT][HD]
            const ko = ((l * KVH + gi) * MAXT + pos) * HD;
            const kto = ((l * KVH + gi) * (MAXT / 16) + pos / 16) * HD * 16 + pos % 16;
            for (0..HD) |d| kc[kto + d * 16] = @floatCast(kv[gi * HD + d]);
            vc[ko..][0..HD].* = @as(@Vector(HD, f16), @floatCast(@as(@Vector(HD, f32), vv[gi * HD ..][0..HD].*)));
        }
        const T = pos + 1;
        job.attn = true;
        job.al = l;
        job.aT = T;
        done.store(0, .monotonic);
        _ = gen.fetchAdd(1, .release);
        attnPart(0);
        while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
        job.attn = false;
        for (0..H) |h| {
            var m: f32 = -std.math.inf(f32);
            for (0..NT) |t| if (pl[t][h] > 0) {
                m = @max(m, pm[t][h]);
            };
            var den: f32 = 0;
            var o: [4]V16f = .{ @splat(0), @splat(0), @splat(0), @splat(0) };
            for (0..NT) |t| if (pl[t][h] > 0) {
                const f = @exp(pm[t][h] - m);
                den += pl[t][h] * f;
                inline for (0..4) |c| o[c] = @mulAdd(V16f, @splat(f), po[t][h][c], o[c]);
            };
            inline for (0..4) |c| o[c] = o[c] / @as(V16f, @splat(den));
            att[h * HD ..][0..HD].* = @bitCast(o);
        }
        dispatch(&att, &.{w.wo}, &.{&tmp});
        for (&xr, tmp) |*a, b| a.* += b;
        rmsnorm(&hb, &xr, w.fn_);
        dispatch(&hb, &.{ w.wg, w.wu }, &.{ &g, &u });
        {
            var i: usize = 0;
            while (i < F) : (i += 16) {
                const gv: V16f = g[i..][0..16].*;
                const uv: V16f = u[i..][0..16].*;
                g[i..][0..16].* = gv / (@as(V16f, @splat(1.0)) + vexp(-gv)) * uv;
            }
        }
        dispatch(&g, &.{w.wd}, &.{&tmp});
        for (&xr, tmp) |*a, b| a.* += b;
    }
    rmsnorm(&hb, &xr, onorm);
    dispatch(&hb, &.{emb}, &.{&logits});
}

fn argmax() usize {
    var b: usize = 0;
    for (logits, 0..) |v, i| if (v > logits[b]) {
        b = i;
    };
    return b;
}

pub fn main(init: std.process.Init.Minimal) !void {
    const mix = init.args.vector.len > 1;
    // mmap weights
    const fd: i32 = @intCast(linux.open(if (mix) "smol_mix.sun" else "smol.sun", .{}, 0));
    var st: linux.Statx = undefined;
    _ = linux.statx(fd, "", linux.AT.EMPTY_PATH, .{ .SIZE = true }, &st);
    const sz: usize = @intCast(st.size);
    const m = linux.mmap(null, sz, .{ .READ = true }, .{ .TYPE = .PRIVATE, .POPULATE = true }, fd, 0);
    base = @ptrFromInt(m);

    emb = tq8(V, D);
    for (&layers) |*w| {
        w.an = tf32(D);
        w.wq = if (mix) tq4(D, D) else tq8(D, D);
        w.wk = tq8(KVH * HD, D);
        w.wv = tq8(KVH * HD, D);
        w.wo = if (mix) tq4(D, D) else tq8(D, D);
        w.fn_ = tf32(D);
        w.wg = if (mix) tq4(F, D) else tq8(F, D);
        w.wu = if (mix) tq4(F, D) else tq8(F, D);
        if (mix and std.mem.eql(f32, w.wg.inv.?[0..D], w.wu.inv.?[0..D])) w.wu.inv = w.wg.inv;
        w.wd = tq8(D, F);
    }
    onorm = tf32(D);
    if (off != sz) std.debug.print("layout mismatch: off={d} file={d}\n", .{ off, sz });

    const alloc = std.heap.page_allocator;
    kc = try alloc.alignedAlloc(f16, .@"64", L * MAXT * KVH * HD);
    vc = try alloc.alignedAlloc(f16, .@"64", L * MAXT * KVH * HD);
    var th: [NT - 1]std.Thread = undefined;
    for (&th, 1..) |*t, i| t.* = try std.Thread.spawn(.{}, worker, .{i});

    const prompt = [_]usize{ 1, 4093, 198, 1780, 314, 260, 3575, 282, 4649, 47, 2, 198, 1, 520, 9531, 198 };
    // dump prompt logits for reference comparison
    const out = try alloc.alloc(f32, prompt.len * V);
    for (prompt, 0..) |t, p| {
        forward(t, p);
        @memcpy(out[p * V ..][0..V], &logits);
    }
    const ofd: i32 = @intCast(linux.open("zig_logits.bin", .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true }, 0o644));
    const argmax0 = argmax();
    const ob = std.mem.sliceAsBytes(out);
    var w: usize = 0;
    while (w < ob.len) w += linux.write(ofd, ob[w..].ptr, ob.len - w);

    // greedy decode, timed: 5 runs from same prompt state (KV beyond prompt is overwritten)
    const NGEN = 64;
    var toks: [NGEN]usize = undefined;
    var rates: [5]f64 = undefined;
    var mvfrac: f64 = 0;
    for (&rates) |*rt| {
        var tok = argmax0;
        t_mv = 0;
        const t0 = now();
        for (0..NGEN) |i| {
            toks[i] = tok;
            forward(tok, prompt.len + i);
            tok = argmax();
        }
        const dt = now() - t0;
        rt.* = NGEN / dt;
        mvfrac = t_mv / dt;
    }
    std.mem.sort(f64, &rates, {}, std.sort.asc(f64));
    std.debug.print("decode tok/s: best={d:.1} median={d:.1} worst={d:.1}  matvec share(last run)={d:.0}%\nids:", .{ rates[4], rates[2], rates[0], mvfrac * 100 });
    for (toks) |t| std.debug.print(" {d}", .{t});
    std.debug.print("\n", .{});
    quit.store(true, .monotonic);
    for (th) |t| t.join();
}
