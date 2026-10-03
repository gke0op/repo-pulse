// gri.zig — Gemma 3 270M decoder, row-interleaved (16-row) Q8 kernels + RI nibble-plane head cascade.
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
    ri4: bool = false, // row-interleaved Q4_0 (16-row groups)
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
fn tq8(rows: usize, k: usize) Q8 { // row-interleaved: (rows/16) groups x (k/32) blocks x 544B
    const q: [*]const V64u = @ptrCast(@alignCast(take(rows * k / 32 * 34)));
    return .{ .q = q, .d = undefined, .rows = rows, .k = k };
}
fn tq4(rows: usize, k: usize) Q8 {
    const q: [*]const V64u = @ptrCast(@alignCast(take(rows * k / 2)));
    const d: [*]const f16 = @ptrCast(@alignCast(take(rows * k / 32 * 2)));
    const inv: [*]const f32 = @ptrCast(@alignCast(take(k * 4)));
    return .{ .q = q, .d = d, .rows = rows, .k = k, .inv = inv };
}
fn tq4ri(rows: usize, k: usize) Q8 { // row-interleaved Q4: (rows/16) x (k/32) x 288B
    const q: [*]const V64u = @ptrCast(@alignCast(take(rows * k / 32 * 18)));
    return .{ .q = q, .d = undefined, .rows = rows, .k = k, .ri4 = true };
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
    xdb: [F / 32]f32 = undefined,
    sxb: [F / 32]i32 = undefined,
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
            out.xdb[p * 2 + h] = dd;
            out.sxb[p * 2 + h] = s;
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

const RIB = 544; // bytes per (16-row group, 32-col block) in RI Q8
fn riRows(W: [*]const u8, k: usize, x: *const XQ, y: [*]f32, g0: usize, g1: usize) void {
    const nb = k / 32;
    const gb = nb * RIB;
    const xb: [*]const i8 = @ptrCast(&x.q);
    var gi_ = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = W + gi_ * gb;
        if (gi_ + 2 < g1) {
            var c: usize = 0;
            while (c < gb) : (c += 64) @prefetch(W + (gi_ + 2) * gb + c, .{});
        }
        var acc: V16f = @splat(0);
        for (0..nb) |b| {
            const bp = gp + b * RIB;
            var ai: V16i = @splat(-128 * x.sxb[b]);
            inline for (0..8) |c| {
                const w: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + c * 64))).*;
                const xv: u32 = @bitCast(xb[b * 32 + c * 4 ..][0..4].*);
                ai = dpbusd(ai, w, @bitCast(@as(V16i, @splat(@bitCast(xv)))));
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 512))).*));
            acc = @mulAdd(V16f, @floatFromInt(ai), sc * @as(V16f, @splat(x.xdb[b])), acc);
        }
        y[gi_ * 16 ..][0..16].* = acc;
    }
}

const RIB4 = 288; // bytes per (16-row group, 32-col block) in RI Q4
fn riRows4(W: [*]const u8, k: usize, x: *const XQ, y: [*]f32, g0: usize, g1: usize) void {
    const nb = k / 32;
    const gb = nb * RIB4;
    const xb: [*]const i8 = @ptrCast(&x.q);
    const m4: V64u = @splat(0x0F);
    var gi_: usize = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = W + gi_ * gb;
        if (gi_ + 2 < g1) {
            var c: usize = 0;
            while (c < gb) : (c += 64) @prefetch(W + (gi_ + 2) * gb + c, .{});
        }
        var acc: V16f = @splat(0);
        for (0..nb) |b| {
            const bp = gp + b * RIB4;
            var ai: V16i = @splat(-8 * x.sxb[b]);
            inline for (0..4) |kk| {
                const v: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + kk * 64))).*;
                const x0: u32 = @bitCast(xb[b * 32 + kk * 8 ..][0..4].*);
                const x1: u32 = @bitCast(xb[b * 32 + kk * 8 + 4 ..][0..4].*);
                ai = dpbusd(ai, v & m4, @bitCast(@as(V16i, @splat(@bitCast(x0)))));
                ai = dpbusd(ai, (v >> @splat(4)) & m4, @bitCast(@as(V16i, @splat(@bitCast(x1)))));
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 256))).*));
            acc = @mulAdd(V16f, @floatFromInt(ai), sc * @as(V16f, @splat(x.xdb[b])), acc);
        }
        y[gi_ * 16 ..][0..16].* = acc;
    }
}

fn matvecRows(w: Q8, x: *const XQ, y: [*]f32, r0: usize, r1: usize) void {
    if (w.ri4) return riRows4(@ptrCast(w.q), w.k, x, y, r0 / 16, r1 / 16);
    if (w.inv != null) return matvecRows4(w, x, y, r0, r1);
    riRows(@ptrCast(w.q), w.k, x, y, r0 / 16, r1 / 16); // r0, r1 are multiples of 16
}

// ---------------- batched (prefill) kernels: one weight load feeds B tokens ----------------
const BMAX = 8;
fn riRowsB(comptime B: usize, W: [*]const u8, k: usize, xs: *const [BMAX]XQ, y: [*]f32, ld: usize, g0: usize, g1: usize) void {
    const nb = k / 32;
    const gb = nb * RIB;
    var gi_: usize = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = W + gi_ * gb;
        var acc: [B]V16f = @splat(@splat(0));
        for (0..nb) |b| {
            const bp = gp + b * RIB;
            var ai: [B]V16i = undefined;
            inline for (0..B) |t| ai[t] = @splat(-128 * xs[t].sxb[b]);
            inline for (0..8) |c| {
                const w: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + c * 64))).*;
                inline for (0..B) |t| {
                    const xb: [*]const i8 = @ptrCast(&xs[t].q);
                    const xv: u32 = @bitCast(xb[b * 32 + c * 4 ..][0..4].*);
                    ai[t] = dpbusd(ai[t], w, @bitCast(@as(V16i, @splat(@bitCast(xv)))));
                }
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 512))).*));
            inline for (0..B) |t| acc[t] = @mulAdd(V16f, @floatFromInt(ai[t]), sc * @as(V16f, @splat(xs[t].xdb[b])), acc[t]);
        }
        inline for (0..B) |t| y[t * ld + gi_ * 16 ..][0..16].* = acc[t];
    }
}
fn riRows4B(comptime B: usize, W: [*]const u8, k: usize, xs: *const [BMAX]XQ, y: [*]f32, ld: usize, g0: usize, g1: usize) void {
    const nb = k / 32;
    const gb = nb * RIB4;
    const m4: V64u = @splat(0x0F);
    var gi_: usize = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = W + gi_ * gb;
        var acc: [B]V16f = @splat(@splat(0));
        for (0..nb) |b| {
            const bp = gp + b * RIB4;
            var ai: [B]V16i = undefined;
            inline for (0..B) |t| ai[t] = @splat(-8 * xs[t].sxb[b]);
            inline for (0..4) |kk| {
                const v: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + kk * 64))).*;
                const lo = v & m4;
                const hi = (v >> @splat(4)) & m4;
                inline for (0..B) |t| {
                    const xb: [*]const i8 = @ptrCast(&xs[t].q);
                    const x0: u32 = @bitCast(xb[b * 32 + kk * 8 ..][0..4].*);
                    const x1: u32 = @bitCast(xb[b * 32 + kk * 8 + 4 ..][0..4].*);
                    ai[t] = dpbusd(ai[t], lo, @bitCast(@as(V16i, @splat(@bitCast(x0)))));
                    ai[t] = dpbusd(ai[t], hi, @bitCast(@as(V16i, @splat(@bitCast(x1)))));
                }
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 256))).*));
            inline for (0..B) |t| acc[t] = @mulAdd(V16f, @floatFromInt(ai[t]), sc * @as(V16f, @splat(xs[t].xdb[b])), acc[t]);
        }
        inline for (0..B) |t| y[t * ld + gi_ * 16 ..][0..16].* = acc[t];
    }
}
fn matvecRowsB(w: Q8, nbt: usize, xs: *const [BMAX]XQ, y: [*]f32, ld: usize, r0: usize, r1: usize) void {
    switch (nbt) {
        inline 1...BMAX => |B| {
            if (w.ri4) riRows4B(B, @ptrCast(w.q), w.k, xs, y, ld, r0 / 16, r1 / 16) else riRowsB(B, @ptrCast(w.q), w.k, xs, y, ld, r0 / 16, r1 / 16);
        },
        else => unreachable,
    }
}

// ---------------- spin thread pool ----------------
const Job = struct { headb: usize = 0, attnb: bool = false, apos0: usize = 0, aglob: bool = false, nbt: usize = 0, ld: [3]usize = undefined, head: bool = false, attn: bool = false, al: usize = 0, aT: usize = 0, alo: usize = 0, n: usize = 0, w: [3]Q8 = undefined, y: [3][*]f32 = undefined, xs: [3]*const XQ = undefined };
var job: Job = .{};
var gen = std.atomic.Value(u32).init(0);
var done = std.atomic.Value(u32).init(0);
var quit = std.atomic.Value(bool).init(false);

fn runShare(tid: usize) void {
    if (job.attn) return attnPart(tid);
    if (job.attnb) { // batched prefill attention: thread tid takes tokens tid, tid+NT, ...
        var i = tid;
        while (i < job.nbt) : (i += NT) attnToken(tid, job.al, job.apos0 + i, job.aglob, &qB[i], &attB[i]);
        return;
    }
    if (job.head) return headPart(tid);
    if (job.headb > 0) {
        switch (job.headb) {
            inline 1...BMAX => |B| headPartB(B, tid),
            else => unreachable,
        }
        return;
    }
    if (job.nbt > 0) {
        for (0..job.n) |j| {
            const rows = job.w[j].rows;
            const chunk = (rows / NT + 15) & ~@as(usize, 15);
            const r0 = @min(rows, tid * chunk);
            const r1 = if (tid == NT - 1) rows else @min(rows, (tid + 1) * chunk);
            matvecRowsB(job.w[j], job.nbt, &xqb, job.y[j], job.ld[j], r0, r1);
        }
        return;
    }
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
var xqb: [BMAX]XQ = @splat(.{});
fn dispatchB(nbt: usize, src: [*]const f32, sld: usize, k: usize, ws: []const Q8, ys: []const [*]f32, lds: []const usize) void {
    for (0..nbt) |t| quant(src[t * sld ..][0..k], &xqb[t]);
    job.n = ws.len;
    for (ws, ys, lds, 0..) |w, y, ld, i| {
        job.w[i] = w;
        job.y[i] = y;
        job.ld[i] = ld;
    }
    job.nbt = nbt;
    done.store(0, .monotonic);
    _ = gen.fetchAdd(1, .release);
    runShare(0);
    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
    job.nbt = 0;
}
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
            var acc4: [4][G]V16f = @splat(@splat(@splat(0))); // 4 independent FMA chains per head
            var d: usize = 0;
            while (d < HD) : (d += 4) {
                inline for (0..4) |u_| {
                    const kd: V16f = @floatCast(kt[d + u_]);
                    inline for (0..G) |j| acc4[u_][j] = @mulAdd(V16f, @splat(qv[(gi * G + j) * HD + d + u_]), kd, acc4[u_][j]);
                }
            }
            var acc: [G]V16f = undefined;
            inline for (0..G) |j| acc[j] = (acc4[0][j] + acc4[1][j]) + (acc4[2][j] + acc4[3][j]);
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
        const vbase: [*]const V16h = @ptrCast(@alignCast(vc.ptr + ((l * KVH + gi) * MAXT + t0) * HD));
        const ilo: usize = if (lo > t0) lo - t0 else 0; // skip masked positions below the window
        for (0..NV) |c| {
            var oc: [G]V16f = @splat(@splat(0));
            for (ilo..n) |i| {
                const v: V16f = @floatCast(vbase[i * NV + c]);
                inline for (0..G) |j| oc[j] = @mulAdd(V16f, @splat(sc_[j][i]), v, oc[j]);
            }
            inline for (0..G) |j| po[tid][gi * G + j][c] = oc[j]; // store slice directly (no 1KB array copies)
        }
        inline for (0..G) |j| {
            pm[tid][gi * G + j] = mx[j];
            pl[tid][gi * G + j] = sum[j];
        }
    }
}

// one token's full attention on one thread (no flash merge); scratch psc[tid]
fn attnToken(tid: usize, l: usize, pos: usize, global: bool, q: *const [H * HD]f32, out: *[H * HD]f32) void {
    const T = pos + 1;
    const lo = if (global or pos < WIN) 0 else pos + 1 - WIN;
    const b0 = lo / 16;
    const b1 = (T + 15) / 16;
    const t0 = b0 * 16;
    const n = T - t0;
    const sc_ = &psc[tid];
    for (0..KVH) |gi| {
        var mx: [G]f32 = @splat(-std.math.inf(f32));
        var bb: usize = 0;
        while (b0 + bb < b1) : (bb += 1) {
            const kt: [*]const V16h = @ptrCast(@alignCast(kc.ptr + ((l * KVH + gi) * (MAXT / 16) + b0 + bb) * HD * 16));
            var acc4: [4][G]V16f = @splat(@splat(@splat(0))); // 4 independent FMA chains per head
            var d: usize = 0;
            while (d < HD) : (d += 4) {
                inline for (0..4) |u_| {
                    const kd: V16f = @floatCast(kt[d + u_]);
                    inline for (0..G) |j| acc4[u_][j] = @mulAdd(V16f, @splat(q[(gi * G + j) * HD + d + u_]), kd, acc4[u_][j]);
                }
            }
            var acc: [G]V16f = undefined;
            inline for (0..G) |j| acc[j] = (acc4[0][j] + acc4[1][j]) + (acc4[2][j] + acc4[3][j]);
            const tabs = std.simd.iota(u32, 16) + @as(@Vector(16, u32), @splat(@intCast(t0 + bb * 16)));
            const valid = (tabs >= @as(@Vector(16, u32), @splat(@intCast(lo)))) & (tabs < @as(@Vector(16, u32), @splat(@intCast(T))));
            inline for (0..G) |j| {
                const v = @select(f32, valid, acc[j], @as(V16f, @splat(-std.math.inf(f32))));
                sc_[j][bb * 16 ..][0..16].* = v;
                mx[j] = @max(mx[j], @reduce(.Max, v));
            }
        }
        var sum: [G]f32 = @splat(0);
        const nt = (b1 - b0) * 16;
        inline for (0..G) |j| {
            var b: usize = 0;
            while (b < nt) : (b += 16) {
                const sv: V16f = sc_[j][b..][0..16].*;
                const v = @select(f32, sv > @as(V16f, @splat(-std.math.inf(f32))), vexp(sv - @as(V16f, @splat(mx[j]))), @as(V16f, @splat(0)));
                sc_[j][b..][0..16].* = v;
                sum[j] += @reduce(.Add, v);
            }
        }
        var inv: [G]V16f = undefined;
        inline for (0..G) |j| inv[j] = @splat(1.0 / sum[j]);
        const vbase: [*]const V16h = @ptrCast(@alignCast(vc.ptr + ((l * KVH + gi) * MAXT + t0) * HD));
        for (0..NV) |c| { // 16-lane slice of the head dim outermost: 4 live accumulators, stored directly
            var oc: [G]V16f = @splat(@splat(0));
            for (lo - t0..n) |i| {
                const v: V16f = @floatCast(vbase[i * NV + c]);
                inline for (0..G) |j| oc[j] = @mulAdd(V16f, @splat(sc_[j][i]), v, oc[j]);
            }
            inline for (0..G) |j| out[(gi * G + j) * HD + c * 16 ..][0..16].* = oc[j] * inv[j];
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

fn attention(l: usize, pos: usize, global: bool) void {
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
        inline for (0..NV) |c| att[h * HD + c * 16 ..][0..16].* = o[c] / @as(V16f, @splat(den));
    }
}

var xrB: [BMAX][D]f32 = undefined;
var hbB: [BMAX][D]f32 = undefined;
var qB: [BMAX][H * HD]f32 = undefined;
var kB: [BMAX][KVH * HD]f32 = undefined;
var vB: [BMAX][KVH * HD]f32 = undefined;
var attB: [BMAX][H * HD]f32 = undefined;
var tmpB: [BMAX][D]f32 = undefined;
var gB: [BMAX][F]f32 = undefined;
var uB: [BMAX][F]f32 = undefined;
var rcB: [BMAX][2][HD / 2]f32 = undefined;
var rsB: [BMAX][2][HD / 2]f32 = undefined;

fn embedRow(tok: usize, out: *[D]f32) void {
    const gp: [*]const u8 = @as([*]const u8, @ptrCast(emb.q)) + (tok / 16) * (D / 32) * RIB;
    const j = tok % 16;
    const sq = @sqrt(@as(f32, D));
    for (0..D) |i| {
        const bp = gp + (i / 32) * RIB;
        const byte = bp[((i % 32) / 4) * 64 + j * 4 + i % 4];
        const sc = @as(*const [16]f16, @ptrCast(@alignCast(bp + 512)))[j];
        out[i] = (@as(f32, @floatFromInt(byte)) - 128.0) * @as(f32, sc) * sq;
    }
}

// up to BMAX tokens at positions pos0.. ; leaves the last token's final residual in xr (head not run)
var exact_attn = false; // verify path: use the same attention numerics as single-token decode
fn forwardBatch(toks: []const usize, pos0: usize) void {
    const nb = toks.len;
    for (toks, 0..) |t, i| {
        embedRow(t, &xrB[i]);
        ropeTable(pos0 + i);
        rcB[i] = rcos;
        rsB[i] = rsin;
    }
    for (&layers, 0..) |*w, l| {
        const global = l % 6 == 5;
        rsel = @intFromBool(global);
        for (0..nb) |i| rmsnorm(&hbB[i], &xrB[i], w.an);
        dispatchB(nb, @ptrCast(&hbB), D, D, &.{ w.wq, w.wk, w.wv }, &.{ @ptrCast(&qB), @ptrCast(&kB), @ptrCast(&vB) }, &.{ H * HD, KVH * HD, KVH * HD });
        for (0..nb) |i| {
            const pos = pos0 + i;
            rcos = rcB[i];
            rsin = rsB[i];
            for (0..H) |h| rmsnorm(qB[i][h * HD ..][0..HD], qB[i][h * HD ..][0..HD], w.qn);
            for (0..KVH) |h| rmsnorm(kB[i][h * HD ..][0..HD], kB[i][h * HD ..][0..HD], w.kn);
            rope(&qB[i]);
            rope(&kB[i]);
            for (&qB[i]) |*a| a.* *= 1.0 / 16.0;
            for (0..KVH) |gi| {
                const vo = ((l * KVH + gi) * MAXT + pos) * HD;
                vc[vo..][0..HD].* = @as(@Vector(HD, f16), @floatCast(@as(@Vector(HD, f32), vB[i][gi * HD ..][0..HD].*)));
                const kto = ((l * KVH + gi) * (MAXT / 16) + pos / 16) * HD * 16 + pos % 16;
                for (0..HD) |d| kc[kto + d * 16] = @floatCast(kB[i][gi * HD + d]);
            }
        }
        if (exact_attn) {
            for (0..nb) |i| {
                qv = qB[i];
                attention(l, pos0 + i, global);
                attB[i] = att;
            }
        } else {
        // causal: token i sees positions <= pos0+i (its own and earlier KV already written)
        job.attnb = true;
        job.al = l;
        job.apos0 = pos0;
        job.aglob = global;
        job.nbt = nb;
        done.store(0, .monotonic);
        _ = gen.fetchAdd(1, .release);
        runShare(0);
        while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
        job.attnb = false;
        job.nbt = 0;
        }
        dispatchB(nb, @ptrCast(&attB), H * HD, H * HD, &.{w.wo}, &.{@ptrCast(&tmpB)}, &.{D});
        for (0..nb) |i| {
            rmsnorm(&tmpB[i], &tmpB[i], w.pan);
            for (&xrB[i], tmpB[i]) |*a, b| a.* += b;
            rmsnorm(&hbB[i], &xrB[i], w.fn_);
        }
        dispatchB(nb, @ptrCast(&hbB), D, D, &.{ w.wg, w.wu }, &.{ @ptrCast(&gB), @ptrCast(&uB) }, &.{ F, F });
        for (0..nb) |i| {
            var e: usize = 0;
            while (e < F) : (e += 16) {
                const gv: V16f = gB[i][e..][0..16].*;
                const uv: V16f = uB[i][e..][0..16].*;
                const z = @as(V16f, @splat(0.7978845608028654)) * (gv + @as(V16f, @splat(0.044715)) * gv * gv * gv);
                const th = @as(V16f, @splat(1.0)) - @as(V16f, @splat(2.0)) / (vexp(z * @as(V16f, @splat(2.0))) + @as(V16f, @splat(1.0)));
                gB[i][e..][0..16].* = @as(V16f, @splat(0.5)) * gv * (@as(V16f, @splat(1.0)) + th) * uv;
            }
        }
        dispatchB(nb, @ptrCast(&gB), F, F, &.{w.wd}, &.{@ptrCast(&tmpB)}, &.{D});
        for (0..nb) |i| {
            rmsnorm(&tmpB[i], &tmpB[i], w.pfn);
            for (&xrB[i], tmpB[i]) |*a, b| a.* += b;
        }
    }
    xr = xrB[nb - 1];
}

// ---------------- speculative decoding (prompt-lookup drafts, batched verification) ----------------
var logitsB: [BMAX][V]f32 = undefined;
fn argmaxOf(v: *const [V]f32) usize {
    var bv: V16f = @splat(-std.math.inf(f32));
    var bi: @Vector(16, u32) = @splat(0);
    var i: usize = 0;
    while (i < V) : (i += 16) {
        const x: V16f = v[i..][0..16].*;
        const m = x > bv;
        bv = @select(f32, m, x, bv);
        bi = @select(u32, m, std.simd.iota(u32, 16) + @as(@Vector(16, u32), @splat(@intCast(i))), bi);
    }
    const mx = @reduce(.Max, bv);
    const big: @Vector(16, u32) = @splat(std.math.maxInt(u32));
    return @reduce(.Min, @select(u32, bv == @as(V16f, @splat(mx)), bi, big)); // lowest index among maxima
}
// run toks at pos0.. in one batched pass; preds[i] = greedy next token after toks[i]
fn verifyBatch(toks: []const usize, pos0: usize, preds: []usize) void {
    exact_attn = true;
    forwardBatch(toks, pos0);
    exact_attn = false;
    for (0..toks.len) |i| rmsnorm(&hbB[i], &xrB[i], onorm);
    if (use_casc) {
        headCascadeB(toks.len, preds);
    } else {
        dispatchB(toks.len, @ptrCast(&hbB), D, D, &.{emb}, &.{@ptrCast(&logitsB)}, &.{V});
        for (0..toks.len) |i| preds[i] = argmaxOf(&logitsB[i]);
    }
}
// prompt lookup: find the latest earlier occurrence of the trailing n-gram (n=3..1), copy what followed
var dlen: usize = 4; // adaptive draft length: grows on full accepts, shrinks on misses
fn draft(hist: []const usize, out_full: []usize) usize {
    const out = out_full[0..@min(out_full.len, dlen)];
    var n: usize = 3;
    while (n >= 2) : (n -= 1) { // unigram matches are too noisy to be worth a verify pass
        if (hist.len <= n) continue;
        const tail = hist[hist.len - n ..];
        var j: usize = hist.len - n;
        while (j > 0) {
            j -= 1;
            if (std.mem.eql(usize, hist[j .. j + n], tail)) {
                var k: usize = 0;
                while (k < out.len and j + n + k < hist.len - n) : (k += 1) out[k] = hist[j + n + k];
                if (k > 0) return k;
            }
        }
    }
    return 0;
}

// batched prompt prefill; computes logits (or cascade) for the last prompt token
fn prefill(toks: []const usize, pos0: usize) void {
    var i: usize = 0;
    while (i < toks.len) : (i += BMAX) forwardBatch(toks[i..@min(toks.len, i + BMAX)], pos0 + i);
    finalHead();
}

fn forward(tok: usize, pos: usize) void {
    {
        const gp: [*]const u8 = @as([*]const u8, @ptrCast(emb.q)) + (tok / 16) * (D / 32) * RIB;
        const j = tok % 16;
        const sq = @sqrt(@as(f32, D));
        for (0..D) |i| {
            const bp = gp + (i / 32) * RIB;
            const byte = bp[((i % 32) / 4) * 64 + j * 4 + i % 4];
            const sc = @as(*const [16]f16, @ptrCast(@alignCast(bp + 512)))[j];
            xr[i] = (@as(f32, @floatFromInt(byte)) - 128.0) * @as(f32, sc) * sq;
        }
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
        attention(l, pos, global);
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
    finalHead();
}

fn finalHead() void {
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
var qat = false;
var ppmode = false;
var genmode = false;
var check = false;
var n_checked: usize = 0;
var n_mismatch: usize = 0;
var n_fallback: usize = 0;
var cand_total: usize = 0;
const HIB = 288; // RI nibble block: 4x64B + 32B scales
var hiq: [*]const u8 = undefined;
var hsq: [D / 32]f32 = undefined; // 21.25 * sum(xq_b^2)
var hc: [V]f32 align(64) = undefined;
var hs2: [V]f32 align(64) = undefined;
var hmid: [D / 64]V16f = undefined; // lanes h*8: 7.5*sum(xq_b)
var hq2: [D / 64]V16f = undefined; // lanes h*8: 21.25*sum(xq_b^2)
var casc_best: usize = 0;
var cand: [CAP]u32 = undefined;

fn headPart(tid: usize) void {
    const m4: V64u = @splat(0x0F);
    const NG = V / 16;
    const gb = (D / 32) * HIB;
    const g0: usize = NG * tid / NT;
    const g1: usize = NG * (tid + 1) / NT;
    const xb: [*]const i8 = @ptrCast(&xq.q);
    var gi_: usize = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = hiq + gi_ * gb;
        if (gi_ + 2 < g1) {
            var c: usize = 0;
            while (c < gb) : (c += 64) @prefetch(hiq + (gi_ + 2) * gb + c, .{});
        }
        var acc: V16f = @splat(0);
        var accv: V16f = @splat(0);
        for (0..D / 32) |b| {
            const bp = gp + b * HIB;
            var ai: V16i = @splat(-8 * xq.sxb[b]);
            inline for (0..4) |kk| {
                const v: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + kk * 64))).*;
                const x0: u32 = @bitCast(xb[b * 32 + kk * 8 ..][0..4].*);
                const x1: u32 = @bitCast(xb[b * 32 + kk * 8 + 4 ..][0..4].*);
                ai = dpbusd(ai, v & m4, @bitCast(@as(V16i, @splat(@bitCast(x0)))));
                ai = dpbusd(ai, (v >> @splat(4)) & m4, @bitCast(@as(V16i, @splat(@bitCast(x1)))));
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 256))).*));
            const scl = sc * @as(V16f, @splat(xq.xdb[b]));
            const vf = @mulAdd(V16f, @floatFromInt(ai), @splat(16.0), @splat(7.5 * @as(f32, @floatFromInt(xq.sxb[b]))));
            acc = @mulAdd(V16f, vf, scl, acc);
            accv = @mulAdd(V16f, scl * scl, @splat(hsq[b]), accv);
        }
        hc[gi_ * 16 ..][0..16].* = acc;
        hs2[gi_ * 16 ..][0..16].* = accv;
    }
}

// batched coarse pass: one read of the nibble plane serves B tokens
var hcB: [BMAX][V]f32 align(64) = undefined;
var hs2B: [BMAX][V]f32 align(64) = undefined;
var hsqB: [BMAX][D / 32]f32 = undefined;
fn headPartB(comptime B: usize, tid: usize) void {
    const m4: V64u = @splat(0x0F);
    const NG = V / 16;
    const gb = (D / 32) * HIB;
    const g0: usize = NG * tid / NT;
    const g1: usize = NG * (tid + 1) / NT;
    var gi_: usize = g0;
    while (gi_ < g1) : (gi_ += 1) {
        const gp = hiq + gi_ * gb;
        if (gi_ + 2 < g1) {
            var c: usize = 0;
            while (c < gb) : (c += 64) @prefetch(hiq + (gi_ + 2) * gb + c, .{});
        }
        var acc: [B]V16f = @splat(@splat(0));
        var accv: [B]V16f = @splat(@splat(0));
        for (0..D / 32) |b| {
            const bp = gp + b * HIB;
            var ai: [B]V16i = undefined;
            inline for (0..B) |t| ai[t] = @splat(-8 * xqb[t].sxb[b]);
            inline for (0..4) |kk| {
                const v: V64u = @as(*const [64]u8, @ptrCast(@alignCast(bp + kk * 64))).*;
                const lo = v & m4;
                const hi = (v >> @splat(4)) & m4;
                inline for (0..B) |t| {
                    const xb: [*]const i8 = @ptrCast(&xqb[t].q);
                    const x0: u32 = @bitCast(xb[b * 32 + kk * 8 ..][0..4].*);
                    const x1: u32 = @bitCast(xb[b * 32 + kk * 8 + 4 ..][0..4].*);
                    ai[t] = dpbusd(ai[t], lo, @bitCast(@as(V16i, @splat(@bitCast(x0)))));
                    ai[t] = dpbusd(ai[t], hi, @bitCast(@as(V16i, @splat(@bitCast(x1)))));
                }
            }
            const sc: V16f = @floatCast(@as(@Vector(16, f16), @as(*const [16]f16, @ptrCast(@alignCast(bp + 256))).*));
            inline for (0..B) |t| {
                const scl = sc * @as(V16f, @splat(xqb[t].xdb[b]));
                const vf = @mulAdd(V16f, @floatFromInt(ai[t]), @splat(16.0), @splat(7.5 * @as(f32, @floatFromInt(xqb[t].sxb[b]))));
                acc[t] = @mulAdd(V16f, vf, scl, acc[t]);
                accv[t] = @mulAdd(V16f, scl * scl, @splat(hsqB[t][b]), accv[t]);
            }
        }
        inline for (0..B) |t| {
            hcB[t][gi_ * 16 ..][0..16].* = acc[t];
            hs2B[t][gi_ * 16 ..][0..16].* = accv[t];
        }
    }
}
// exact greedy argmax for B tokens whose final normed hidden states are in hbB
fn headCascadeB(nb: usize, preds: []usize) void {
    for (0..nb) |t| {
        quant(&hbB[t], &xqb[t]);
        const xb: [*]const i8 = @ptrCast(&xqb[t].q);
        for (0..D / 32) |b| {
            const v: @Vector(32, i32) = xb[b * 32 ..][0..32].*;
            hsqB[t][b] = 21.25 * @as(f32, @floatFromInt(@reduce(.Add, v * v)));
        }
    }
    job.headb = nb;
    done.store(0, .monotonic);
    _ = gen.fetchAdd(1, .release);
    runShare(0);
    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();
    job.headb = 0;
    const k: V16f = @splat(KSIG);
    for (0..nb) |t| {
        var lbv: V16f = @splat(-std.math.inf(f32));
        var r: usize = 0;
        while (r < V) : (r += 16) lbv = @max(lbv, @as(V16f, hcB[t][r..][0..16].*) - k * @sqrt(@as(V16f, hs2B[t][r..][0..16].*)));
        const lb = @reduce(.Max, lbv);
        var n: usize = 0;
        r = 0;
        while (r < V) : (r += 16) {
            const m: u16 = @bitCast(@as(V16f, hcB[t][r..][0..16].*) + k * @sqrt(@as(V16f, hs2B[t][r..][0..16].*)) >= @as(V16f, @splat(lb)));
            if (m != 0) for (0..16) |i| if ((m >> @intCast(i)) & 1 != 0) {
                if (n < CAP) cand[n] = @intCast(r + i);
                n += 1;
            };
        }
        cand_total += n;
        if (n > CAP) { // flat distribution: full Q8 head for this token
            n_fallback += 1;
            riRows(@ptrCast(emb.q), D, &xqb[t], &logits, 0, V / 16);
            preds[t] = argmaxOf(&logits);
            continue;
        }
        var best: usize = cand[0];
        var bv: f32 = -std.math.inf(f32);
        var lastg: usize = std.math.maxInt(usize);
        for (cand[0..n]) |cr| {
            if (cr / 16 != lastg) {
                lastg = cr / 16;
                riRows(@ptrCast(emb.q), D, &xqb[t], &logits, lastg, lastg + 1);
            }
            if (logits[cr] > bv) {
                bv = logits[cr];
                best = cr;
            }
        }
        preds[t] = best;
    }
}

fn headCascade(src: []const f32) void {
    quant(src, &xq);
    {
        const xb: [*]const i8 = @ptrCast(&xq.q);
        for (0..D / 32) |b| {
            const v: @Vector(32, i32) = xb[b * 32 ..][0..32].*;
            hsq[b] = 21.25 * @as(f32, @floatFromInt(@reduce(.Add, v * v)));
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
    var lastg: usize = std.math.maxInt(usize);
    for (cand[0..n]) |cr| { // candidates ascending: rescore each 16-row group once
        if (cr / 16 != lastg) {
            lastg = cr / 16;
            riRows(@ptrCast(emb.q), D, &xq, &logits, lastg, lastg + 1);
        }
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
        if (std.mem.eql(u8, sa, "qat")) qat = true;
        if (std.mem.eql(u8, sa, "pp")) ppmode = true;
        if (std.mem.eql(u8, sa, "gen")) genmode = true;
    }
    const want_casc = use_casc;
    use_casc = false;
    const fd: i32 = @intCast(linux.open(if (qat) "gemma_qat.sun" else "gemma_ri.sun", .{}, 0));
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
        w.wq = if (qat) tq4ri(H * HD, D) else tq8(H * HD, D);
        w.wk = if (qat) tq4ri(KVH * HD, D) else tq8(KVH * HD, D);
        w.wv = if (qat) tq4ri(KVH * HD, D) else tq8(KVH * HD, D);
        w.wo = if (qat) tq4ri(D, H * HD) else tq8(D, H * HD);
        w.wg = if (qat) tq4ri(F, D) else tq8(F, D);
        w.wu = if (qat) tq4ri(F, D) else tq8(F, D);
        w.wd = if (qat) tq4ri(D, F) else tq8(D, F);
    }
    onorm = tf32(D);
    { // build RI nibble plane of the vocab head: code = (w+128)>>4 = (w>>4)+8; per block 4x64B + 16 f16 scales
        const hb_ = try std.heap.page_allocator.alignedAlloc(u8, .@"64", (V / 16) * (D / 32) * HIB);
        const src: [*]const u8 = @ptrCast(emb.q);
        for (0..(V / 16) * (D / 32)) |gb| {
            const sp = src + gb * RIB;
            const dp = hb_.ptr + gb * HIB;
            for (0..4) |kk| {
                const a0: V64u = @as(*const [64]u8, @ptrCast(@alignCast(sp + 2 * kk * 64))).*;
                const a1: V64u = @as(*const [64]u8, @ptrCast(@alignCast(sp + (2 * kk + 1) * 64))).*;
                @as(*[64]u8, @ptrCast(@alignCast(dp + kk * 64))).* = (a0 >> @splat(4)) | (a1 & @as(V64u, @splat(0xF0)));
            }
            @memcpy(dp[256..288], sp[512..544]);
        }
        hiq = hb_.ptr;
    }
    if (off != sz) std.debug.print("layout mismatch: off={d} file={d}\n", .{ off, sz });

    const alloc = std.heap.page_allocator;
    kc = try alloc.alignedAlloc(f16, .@"64", L * KVH * MAXT * HD);
    vc = try alloc.alignedAlloc(f16, .@"64", L * KVH * MAXT * HD);
    var th: [NT - 1]std.Thread = undefined;
    for (&th, 1..) |*t, i| t.* = try std.Thread.spawn(.{}, worker, .{i});

    if (genmode) { // prompt ids from prompt_ids.txt -> greedy (cascade) until end of turn; prints ids + timings
        var buf: [65536]u8 = undefined;
        const pfd: i32 = @intCast(linux.open("prompt_ids.txt", .{}, 0));
        const nr = linux.read(pfd, &buf, buf.len);
        var ptoks: [MAXT]usize = undefined;
        var np_: usize = 0;
        var it = std.mem.tokenizeAny(u8, buf[0..nr], ", \n");
        while (it.next()) |tk| : (np_ += 1) ptoks[np_] = try std.fmt.parseInt(usize, tk, 10);
        use_casc = true;
        const t0 = now();
        prefill(ptoks[0..np_], 0);
        const t1 = now();
        var tok = casc_best;
        var outt: [512]usize = undefined;
        var n: usize = 0;
        while (n < 512 and np_ + n < MAXT - 1 and tok != 106 and tok != 1) : (n += 1) {
            outt[n] = tok;
            forward(tok, np_ + n);
            tok = casc_best;
        }
        const t2 = now();
        std.debug.print("TIMING prefill {d} tok {d:.1} ms | decode {d} tok {d:.1} ms ({d:.0} tok/s)\nOUT:", .{ np_, (t1 - t0) * 1e3, n, (t2 - t1) * 1e3, @as(f64, @floatFromInt(n)) / (t2 - t1) });
        for (outt[0..n]) |t| std.debug.print(" {d}", .{t});
        std.debug.print("\n", .{});
        quit.store(true, .monotonic);
        for (th) |t| t.join();
        return;
    }
    if (ppmode) {
        const cal = [_]usize{ 2, 105, 2364, 107, 818, 2255, 63937, 64222, 54264, 506, 32450, 31393, 1418, 9137, 236764, 23513, 506, 6555, 618, 914, 6353, 1053, 14582, 1515, 236761, 37256, 30445, 47874, 2214, 2778, 1131, 7395, 2778, 11628, 528, 22422, 236764, 36122, 12123, 618, 496, 163429, 236761, 2282, 4476, 506, 8289, 236764, 1845, 9835, 4476, 10512, 532, 1299, 1419, 625, 528, 822, 8948, 236761, 799, 236743, 236770, 236819, 236825, 236819, 236764, 101195, 30473, 580, 506, 19656, 236764, 532, 13889, 19061, 506, 184819, 17245, 236761, 1096, 10779, 78113, 236769, 236749, 1473, 994, 538, 768, 538, 655, 236743, 236778, 1663, 10779, 78113, 236769, 236749, 236772, 236770, 236768, 900, 10779, 78113, 236769, 236749, 236772, 236778, 769, 669, 15028, 9139, 573, 1156, 27370, 529, 18763, 236764, 496, 57813, 529, 9551, 236764, 532, 1806, 14318, 35919, 3097, 50704, 236761, 21632, 6224, 11076, 42269, 236764, 532, 13177, 7808, 910, 15749, 1131, 3251, 14558, 236761, 2625, 4733, 3363, 506, 2519, 531, 80554, 1093, 5264, 580, 990, 236764, 840, 24063, 657, 506, 6410, 7261, 236761, 106, 107, 105, 4368, 107, 8291, 563, 496, 2822, 12323, 529, 506, 1816, 2787, 236761 };
        var toks: [512]usize = undefined;
        for (&toks, 0..) |*t, i| t.* = cal[i % cal.len];
        const ref = try alloc.alloc(f32, V);
        for ([_]usize{ 64, 256, 512 }) |N| {
            var t0 = now();
            for (toks[0..N], 0..) |t, p| forward(t, p);
            const dseq = now() - t0;
            @memcpy(ref, &logits);
            var best: f64 = 1e9;
            for (0..3) |_| {
                t0 = now();
                prefill(toks[0..N], 0);
                best = @min(best, now() - t0);
            }
            var md: f32 = 0;
            for (ref, logits) |a, b| md = @max(md, @abs(a - b));
            std.debug.print("prompt {d}: sequential {d:.0} tok/s | batched prefill {d:.0} tok/s | last-token logits max|diff| = {e}\n", .{ N, @as(f64, @floatFromInt(N)) / dseq, @as(f64, @floatFromInt(N)) / best, md });
        }
        quit.store(true, .monotonic);
        for (th) |t| t.join();
        return;
    }
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
