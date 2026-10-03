// gemma.zig — Gemma 3 270M decoder on the same repacked Q8 + AVX-512 VNNI kernels as sun.zig.
const std = @import("std");
const linux = std.os.linux;

const L = 18;
const D = 640;
const H = 4;
const KVH = 1;
const HD = 256;
const F = 2048;
const V = 262144;
const MAXT = 1024;
const WIN = 512; // sliding window for local layers (l % 6 != 5)
const EPS: f32 = 1e-6;
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
const Layer = struct { an: [*]const f32, qn: [*]const f32, kn: [*]const f32, pan: [*]const f32, fn_: [*]const f32, pfn: [*]const f32, wq: Q8, wk: Q8, wv: Q8, wo: Q8, wg: Q8, wu: Q8, wd: Q8 };

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
const Job = struct { head: bool = false, attn: bool = false, al: usize = 0, aT: usize = 0, alo: usize = 0, n: usize = 0, w: [3]Q8 = undefined, y: [3][*]f32 = undefined, xs: [3]*const XQ = undefined };
var job: Job = .{};
var gen = std.atomic.Value(u32).init(0);
var done = std.atomic.Value(u32).init(0);
var quit = std.atomic.Value(bool).init(false);

fn runShare(tid: usize) void {
    if (job.attn) return attnPart(tid);
    if (job.head) return headPart(tid);
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


// ---------------- model (Gemma 3 270M) ----------------
var kc: []f16 = undefined; // K tiles [L][KVH][MAXT/16][HD][16]
var vc: []f16 = undefined; // V rows  [L][KVH][MAXT][HD]
const V16h = @Vector(16, f16);
const NV = HD / 16; // V16f per head vector
const G = H / KVH; // query heads per KV head

var pm: [NT][H]f32 = undefined;
var pl: [NT][H]f32 = undefined;
var po: [NT][H][NV]V16f = undefined;
var psc: [NT][G][MAXT + 16]f32 = undefined;

fn attnPart(tid: usize) void {
    const T = job.aT;
    const l = job.al;
    const lo = job.alo;
    const tb = lo / 16; // first tile touching the window
    const B = (T + 15) / 16 - tb;
    const b0 = tb + B * tid / NT;
    const b1 = tb + B * (tid + 1) / NT;
    const t0 = b0 * 16;
    const n = if (b1 > b0) @min(T, b1 * 16) - t0 else 0;
    for (0..KVH) |gi| {
        var mx: [G]f32 = @splat(-std.math.inf(f32));
        const sc_ = &psc[tid];
        var bb: usize = 0;
        while (bb * 16 < n) : (bb += 1) {
            const kt: [*]const V16h = @ptrCast(@alignCast(kc.ptr + ((l * KVH + gi) * (MAXT / 16) + b0 + bb) * HD * 16));
            var acc: [G]V16f = @splat(@splat(0));
            for (0..HD) |d| {
                const kd: V16f = @floatCast(kt[d]);
                inline for (0..G) |j| acc[j] = @mulAdd(V16f, @splat(qv[(gi * G + j) * HD + d]), kd, acc[j]);
            }
            const tabs = std.simd.iota(u32, 16) + @as(@Vector(16, u32), @splat(@intCast(t0 + bb * 16)));
            const valid = (tabs >= @as(@Vector(16, u32), @splat(@intCast(lo)))) & (tabs < @as(@Vector(16, u32), @splat(@intCast(T))));
            inline for (0..G) |j| {
                const v = @select(f32, valid, acc[j], @as(V16f, @splat(-std.math.inf(f32))));
                sc_[j][bb * 16 ..][0..16].* = v;
                mx[j] = @max(mx[j], @reduce(.Max, v));
            }
        }
        var sum: [G]f32 = @splat(0);
        const nt = ((n + 15) / 16) * 16;
        inline for (0..G) |j| {
            var b: usize = 0;
            while (b < nt) : (b += 16) {
                const s: V16f = sc_[j][b..][0..16].*;
                const v = @select(f32, s > @as(V16f, @splat(-std.math.inf(f32))), vexp(s - @as(V16f, @splat(mx[j]))), @as(V16f, @splat(0)));
                sc_[j][b..][0..16].* = v;
                sum[j] += @reduce(.Add, v);
            }
        }
        var o: [G][NV]V16f = @splat(@splat(@splat(0)));
        for (0..n) |i| {
            if (sc_[0][i] == 0 and sc_[G - 1][i] == 0) continue; // masked (outside window)
            const vh: *const [NV]V16h = @ptrCast(@alignCast(vc.ptr + ((l * KVH + gi) * MAXT + t0 + i) * HD));
            inline for (0..NV) |c| {
                const v: V16f = @floatCast(vh[c]);
                inline for (0..G) |j| o[j][c] = @mulAdd(V16f, @splat(sc_[j][i]), v, o[j][c]);
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

// NEOX rope tables: [0] local (base 1e4), [1] global (base 1e6)
var rcos: [2][HD / 2]f32 = undefined;
var rsin: [2][HD / 2]f32 = undefined;
var rsel: usize = 0;
fn ropeTable(pos: usize) void {
    inline for (0..2) |gl| {
        const b: f32 = if (gl == 0) 10000.0 else 1000000.0;
        for (0..HD / 2) |i| {
            const f = @as(f32, @floatFromInt(pos)) * std.math.pow(f32, b, -@as(f32, @floatFromInt(2 * i)) / HD);
            rcos[gl][i] = @cos(f);
            rsin[gl][i] = @sin(f);
        }
    }
}
fn rope(v: []f32) void {
    var h: usize = 0;
    while (h < v.len) : (h += HD) {
        for (0..HD / 2) |i| {
            const c = rcos[rsel][i];
            const s = rsin[rsel][i];
            const a = v[h + i];
            const b = v[h + i + HD / 2];
            v[h + i] = a * c - b * s;
            v[h + i + HD / 2] = a * s + b * c;
        }
    }
}

var xq: XQ = .{};
var xr: [D]f32 = undefined;
var hb: [D]f32 = undefined;
var qv: [H * HD]f32 = undefined;
var kv: [KVH * HD]f32 = undefined;
var vv: [KVH * HD]f32 = undefined;
var att: [H * HD]f32 = undefined;
var tmp: [D]f32 = undefined;
var g: [F]f32 = undefined;
var u: [F]f32 = undefined;
var logits: [V]f32 = undefined;

fn forward(tok: usize, pos: usize) void {
    {
        const row: [*]const i8 = @ptrCast(emb.q + tok * (D / 64));
        const sq = @sqrt(@as(f32, D));
        for (0..D) |i| xr[i] = @as(f32, @floatFromInt(row[i])) * @as(f32, emb.d[tok * (D / 32) + i / 32]) * sq;
    }
    ropeTable(pos);
    for (&layers, 0..) |*w, l| {
        const global = l % 6 == 5;
        rsel = @intFromBool(global);
        rmsnorm(&hb, &xr, w.an);
        dispatch(&hb, &.{ w.wq, w.wk, w.wv }, &.{ &qv, &kv, &vv });
        for (0..H) |h| rmsnorm(qv[h * HD ..][0..HD], qv[h * HD ..][0..HD], w.qn);
        for (0..KVH) |h| rmsnorm(kv[h * HD ..][0..HD], kv[h * HD ..][0..HD], w.kn);
        rope(&qv);
        rope(&kv);
        for (&qv) |*a| a.* *= 1.0 / 16.0; // 1/sqrt(head_dim)
        for (0..KVH) |gi| {
            const vo = ((l * KVH + gi) * MAXT + pos) * HD;
            vc[vo..][0..HD].* = @as(@Vector(HD, f16), @floatCast(@as(@Vector(HD, f32), vv[gi * HD ..][0..HD].*)));
            const kto = ((l * KVH + gi) * (MAXT / 16) + pos / 16) * HD * 16 + pos % 16;
            for (0..HD) |d| kc[kto + d * 16] = @floatCast(kv[gi * HD + d]);
        }
        const T = pos + 1;
        job.attn = true;
        job.al = l;
        job.aT = T;
        job.alo = if (global or pos < WIN) 0 else pos + 1 - WIN;
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
            var o: [NV]V16f = @splat(@splat(0));
            for (0..NT) |t| if (pl[t][h] > 0) {
                const f = @exp(pm[t][h] - m);
                den += pl[t][h] * f;
                inline for (0..NV) |c| o[c] = @mulAdd(V16f, @splat(f), po[t][h][c], o[c]);
            };
            inline for (0..NV) |c| o[c] = o[c] / @as(V16f, @splat(den));
            att[h * HD ..][0..HD].* = @bitCast(o);
        }
        dispatch(&att, &.{w.wo}, &.{&tmp});
        rmsnorm(&tmp, &tmp, w.pan);
        for (&xr, tmp) |*a, b| a.* += b;
        rmsnorm(&hb, &xr, w.fn_);
        dispatch(&hb, &.{ w.wg, w.wu }, &.{ &g, &u });
        {
            var i: usize = 0;
            while (i < F) : (i += 16) { // GELU(tanh) * up ; tanh(z) = 1 - 2/(e^{2z}+1)
                const gv: V16f = g[i..][0..16].*;
                const uv: V16f = u[i..][0..16].*;
                const z = @as(V16f, @splat(0.7978845608028654)) * (gv + @as(V16f, @splat(0.044715)) * gv * gv * gv);
                const th = @as(V16f, @splat(1.0)) - @as(V16f, @splat(2.0)) / (vexp(z * @as(V16f, @splat(2.0))) + @as(V16f, @splat(1.0)));
                g[i..][0..16].* = @as(V16f, @splat(0.5)) * gv * (@as(V16f, @splat(1.0)) + th) * uv;
            }
        }
        dispatch(&g, &.{w.wd}, &.{&tmp});
        rmsnorm(&tmp, &tmp, w.pfn);
        for (&xr, tmp) |*a, b| a.* += b;
    }
    rmsnorm(&hb, &xr, onorm);
    if (use_casc) {
        headCascade(&hb);
        if (check) {
            dispatch(&hb, &.{emb}, &.{&logits});
            n_checked += 1;
            if (argmax() != casc_best) n_mismatch += 1;
        }
    } else dispatch(&hb, &.{emb}, &.{&logits});
}

// ---------------- vocab-head bit-plane cascade ----------------
// q = 16*hi + lo, lo in [0,15]. Pass 1 reads only hi nibbles: coarse c_r (lo -> midpoint 7.5) and
// sigma_r^2 = Var(lo)*sum_b d^2 xd^2 sum xq^2. Keep rows with c+K*sigma >= max(c-K*sigma); rescore them in Q8.
const KSIG: f32 = 7.0;
const CAP: usize = 16384;
var use_casc = false;
var check = false;
var n_checked: usize = 0;
var n_mismatch: usize = 0;
var n_fallback: usize = 0;
var cand_total: usize = 0;
var hiq: [*]const @Vector(32, u8) = undefined; // V * (D/64) nibble pairs
var hc: [V]f32 align(64) = undefined;
var hs2: [V]f32 align(64) = undefined;
var hmid: [D / 64]V16f = undefined; // lanes h*8: 7.5*sum(xq_b)
var hq2: [D / 64]V16f = undefined; // lanes h*8: 21.25*sum(xq_b^2)
var casc_best: usize = 0;
var cand: [CAP]u32 = undefined;

fn headPart(tid: usize) void {
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
    const ppr = D / 64;
    const bpr = D / 32;
    const chunk = (V / NT + 15) & ~@as(usize, 15);
    const r0: usize = @min(V, tid * chunk); // usize: @min with comptime V narrows to u19
    const r1: usize = if (tid == NT - 1) V else @min(V, (tid + 1) * chunk);
    var r = r0;
    while (r < r1) : (r += 1) {
        if (r + 16 < r1) {
            const pp: [*]const u8 = @ptrCast(hiq + (r + 16) * ppr);
            var c: usize = 0;
            while (c < D / 2) : (c += 64) @prefetch(pp + c, .{});
        }
        var acc: V16f = @splat(0);
        var accv: V16f = @splat(0);
        for (0..ppr) |p| {
            const w4 = hiq[r * ppr + p];
            const wu: V64u = @shuffle(u8, w4 & m4, w4 >> @splat(4), idx);
            const sd = dpbusd(xq.bias8[p], wu, xq.q[p]);
            const s2: @Vector(2, f32) = @floatCast(@as(@Vector(2, f16), emb.d[r * bpr + 2 * p ..][0..2].*));
            const scl = @shuffle(f32, s2, undefined, lo8) * xq.xs[p];
            acc = @mulAdd(V16f, @mulAdd(V16f, @floatFromInt(sd), @splat(16.0), hmid[p]), scl, acc);
            accv = @mulAdd(V16f, scl * scl, hq2[p], accv);
        }
        hc[r] = @reduce(.Add, acc);
        hs2[r] = @reduce(.Add, accv);
    }
}

fn headCascade(src: []const f32) void {
    quant(src, &xq);
    for (0..D / 64) |p| {
        const qa: [64]i8 = xq.q[p];
        hmid[p] = @splat(0);
        hq2[p] = @splat(0);
        inline for (0..2) |h| {
            const v: @Vector(32, i32) = qa[h * 32 ..][0..32].*;
            hmid[p][h * 8] = 7.5 * @as(f32, @floatFromInt(@reduce(.Add, v)));
            hq2[p][h * 8] = 21.25 * @as(f32, @floatFromInt(@reduce(.Add, v * v)));
        }
    }
    job.head = true;
    done.store(0, .monotonic);
    _ = gen.fetchAdd(1, .release);
    headPart(0);
    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
    job.head = false;
    // best lower bound
    const k: V16f = @splat(KSIG);
    var lbv: V16f = @splat(-std.math.inf(f32));
    var r: usize = 0;
    while (r < V) : (r += 16) {
        const c: V16f = hc[r..][0..16].*;
        const sg = @sqrt(@as(V16f, hs2[r..][0..16].*));
        lbv = @max(lbv, c - k * sg);
    }
    const lb = @reduce(.Max, lbv);
    // collect candidates
    var n: usize = 0;
    r = 0;
    while (r < V) : (r += 16) {
        const c: V16f = hc[r..][0..16].*;
        const sg = @sqrt(@as(V16f, hs2[r..][0..16].*));
        const m: u16 = @bitCast(c + k * sg >= @as(V16f, @splat(lb)));
        if (m != 0) {
            for (0..16) |i| if ((m >> @intCast(i)) & 1 != 0) {
                if (n < CAP) cand[n] = @intCast(r + i);
                n += 1;
            };
        }
    }
    cand_total += n;
    if (n > CAP) { // flat distribution: fall back to the full Q8 head
        n_fallback += 1;
        dispatch(src, &.{emb}, &.{&logits});
        casc_best = argmax();
        return;
    }
    var best: usize = cand[0];
    var bv: f32 = -std.math.inf(f32);
    for (cand[0..n]) |cr| {
        matvecRows(emb, &xq, &logits, cr, cr + 1);
        if (logits[cr] > bv) {
            bv = logits[cr];
            best = cr;
        }
    }
    casc_best = best;
}

fn argmax() usize {
    var b: usize = 0;
    for (logits, 0..) |v, i| if (v > logits[b]) {
        b = i;
    };
    return b;
}

pub fn main(init: std.process.Init.Minimal) !void {
    for (init.args.vector[1..]) |a| {
        const sa = std.mem.span(a);
        if (std.mem.eql(u8, sa, "casc")) use_casc = true;
        if (std.mem.eql(u8, sa, "check")) check = true;
    }
    const want_casc = use_casc;
    use_casc = false;
    const fd: i32 = @intCast(linux.open("gemma.sun", .{}, 0));
    var st: linux.Statx = undefined;
    _ = linux.statx(fd, "", linux.AT.EMPTY_PATH, .{ .SIZE = true }, &st);
    const sz: usize = @intCast(st.size);
    const m = linux.mmap(null, sz, .{ .READ = true }, .{ .TYPE = .PRIVATE, .POPULATE = true }, fd, 0);
    base = @ptrFromInt(m);

    emb = tq8(V, D);
    for (&layers) |*w| {
        w.an = tf32(D);
        w.qn = tf32(HD);
        w.kn = tf32(HD);
        w.pan = tf32(D);
        w.fn_ = tf32(D);
        w.pfn = tf32(D);
        w.wq = tq8(H * HD, D);
        w.wk = tq8(KVH * HD, D);
        w.wv = tq8(KVH * HD, D);
        w.wo = tq8(D, H * HD);
        w.wg = tq8(F, D);
        w.wu = tq8(F, D);
        w.wd = tq8(D, F);
    }
    onorm = tf32(D);
    { // build hi-nibble plane of the vocab head from its Q8 rows
        const hb_ = try std.heap.page_allocator.alignedAlloc(@Vector(32, u8), .@"64", V * (D / 64));
        const src: [*]const i8 = @ptrCast(emb.q);
        for (0..V) |rr| for (0..D / 64) |p| {
            var bytes: [32]u8 = undefined;
            for (0..32) |i| {
                const a: u8 = @intCast((@as(i16, src[rr * D + p * 64 + i]) >> 4) + 8);
                const b: u8 = @intCast((@as(i16, src[rr * D + p * 64 + 32 + i]) >> 4) + 8);
                bytes[i] = a | (b << 4);
            }
            hb_[rr * (D / 64) + p] = bytes;
        };
        hiq = hb_.ptr;
    }
    if (off != sz) std.debug.print("layout mismatch: off={d} file={d}\n", .{ off, sz });

    const alloc = std.heap.page_allocator;
    kc = try alloc.alignedAlloc(f16, .@"64", L * KVH * MAXT * HD);
    vc = try alloc.alignedAlloc(f16, .@"64", L * KVH * MAXT * HD);
    var th: [NT - 1]std.Thread = undefined;
    for (&th, 1..) |*t, i| t.* = try std.Thread.spawn(.{}, worker, .{i});

    const prompt = [_]usize{ 2, 105, 2364, 107, 3689, 563, 506, 5279, 529, 7001, 236881, 106, 107, 105, 4368, 107 };
    const out = try alloc.alloc(f32, prompt.len * V);
    for (prompt, 0..) |t, p| {
        forward(t, p);
        @memcpy(out[p * V ..][0..V], &logits);
    }
    const ofd: i32 = @intCast(linux.open("zig_logits.bin", .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true }, 0o644));
    const argmax0 = argmax();
    const ob = std.mem.sliceAsBytes(out);
    var wr: usize = 0;
    while (wr < ob.len) wr += linux.write(ofd, ob[wr..].ptr, ob.len - wr);

    // greedy decode, timed
    use_casc = want_casc;
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
            tok = if (use_casc) casc_best else argmax();
        }
        const dt = now() - t0;
        rt.* = NGEN / dt;
        mvfrac = t_mv / dt;
    }
    std.mem.sort(f64, &rates, {}, std.sort.asc(f64));
    if (use_casc) std.debug.print("cascade: tokens={d} mean candidates={d:.0} fallbacks={d}  check: {d} compared, {d} mismatches\n", .{ NGEN * 5, @as(f64, @floatFromInt(cand_total)) / (NGEN * 5), n_fallback, n_checked, n_mismatch });
    std.debug.print("decode tok/s: best={d:.1} median={d:.1} worst={d:.1}  matvec share(last run)={d:.0}%\nids:", .{ rates[4], rates[2], rates[0], mvfrac * 100 });
    for (toks) |t| std.debug.print(" {d}", .{t});
    std.debug.print("\n", .{});
    quit.store(true, .monotonic);
    for (th) |t| t.join();
}
