const std = @import("std");
const linux = std.os.linux;

// Repacked Q8: rows of 64B-aligned int8 pairs-of-blocks + contiguous f16 scales.
// Same bytes as llama.cpp Q8_0 (32 i8 + 1 f16 per 32 weights).
const K: usize = 576;
const BPR: usize = K / 32; // 18 blocks per row
const PPR: usize = BPR / 2; // 9 block-pairs (64B) per row

const V64u = @Vector(64, u8);
const V64i = @Vector(64, i8);
const V16i = @Vector(16, i32);
const V16f = @Vector(16, f32);

fn now() f64 {
    var ts: linux.timespec = undefined;
    _ = linux.clock_gettime(.MONOTONIC, &ts);
    return @as(f64, @floatFromInt(ts.sec)) + @as(f64, @floatFromInt(ts.nsec)) * 1e-9;
}

// acc[i] += sum_{j<4} a[4i+j](u8) * b[4i+j](s8)
inline fn dpbusd(acc: V16i, a: V64u, b: V64i) V16i {
    return asm ("vpdpbusd %[b], %[a], %[acc]"
        : [acc] "=v" (-> V16i),
        : [acc_in] "0" (acc),
          [a] "v" (a),
          [b] "v" (b),
    );
}

const X = struct {
    q: []const V64i, // PPR pairs of x int8
    bias: []const V16i, // lane0 = -128*sum(x blk 2p), lane8 = -128*sum(x blk 2p+1)
    xs: []const V16f, // lanes 0..7 = dx[2p], 8..15 = dx[2p+1]
};

fn matvec(Wq: []const V64u, Wd: []const f16, x: X, y: []f32, r0: usize, r1: usize) void {
    const flip: V64u = @splat(0x80);
    const lo8 = @Vector(16, i32){ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1 };
    var r = r0;
    while (r < r1) : (r += 1) {
        const q = Wq[r * PPR ..][0..PPR];
        const d = Wd[r * BPR ..][0..BPR];
        if (r + 16 < r1) { // prefetch 16 rows ahead (swept: 4/8/16/64)
            const pp: [*]const u8 = @ptrCast(&Wq[(r + 16) * PPR]);
            inline for (0..10) |c| @prefetch(pp + c * 64, .{});
        }
        var acc: V16f = @splat(0);
        inline for (0..PPR) |p| {
            const s = dpbusd(x.bias[p], q[p] ^ flip, x.q[p]);
            const s2: @Vector(2, f32) = @floatCast(@as(@Vector(2, f16), d[2 * p ..][0..2].*));
            const sc = @shuffle(f32, s2, undefined, lo8) * x.xs[p];
            acc = @mulAdd(V16f, @floatFromInt(s), sc, acc);
        }
        y[r] = @reduce(.Add, acc);
    }
}

pub fn main() !void {
    const alloc = std.heap.page_allocator;
    const N: usize = 144_811_360 / (BPR * 34);
    const Wq = try alloc.alignedAlloc(V64u, .@"64", N * PPR);
    const Wd = try alloc.alloc(f16, N * BPR);
    const y = try alloc.alloc(f32, N);
    var xi: [K]i8 = undefined;
    var dx: [BPR]f32 = undefined;
    var seed: u32 = 12345;
    const wb: []u8 = std.mem.sliceAsBytes(Wq);
    for (wb) |*b| {
        seed = seed *% 1664525 +% 1013904223;
        b.* = @truncate(seed >> 24);
    }
    for (Wd, 0..) |*s, i| s.* = @floatCast(0.005 + 0.0001 * @as(f32, @floatFromInt(i % 97)));
    for (&xi) |*q| {
        seed = seed *% 1664525 +% 1013904223;
        q.* = @bitCast(@as(u8, @truncate(seed >> 24)));
    }
    for (&dx, 0..) |*s, i| s.* = 0.02 + 0.001 * @as(f32, @floatFromInt(i));

    var xq: [PPR]V64i = undefined;
    var bias: [PPR]V16i = undefined;
    var xs: [PPR]V16f = undefined;
    for (0..PPR) |p| {
        xq[p] = xi[p * 64 ..][0..64].*;
        bias[p] = @splat(0);
        inline for (0..2) |h| {
            var sum: i32 = 0;
            for (xi[p * 64 + h * 32 ..][0..32]) |v| sum += v;
            bias[p][h * 8] = -128 * sum;
            inline for (0..8) |l| xs[p][h * 8 + l] = dx[2 * p + h];
        }
    }
    const x = X{ .q = &xq, .bias = &bias, .xs = &xs };

    for ([_]usize{ 1, 2 }) |nt| {
        var best: f64 = 1e9;
        for (0..7) |_| {
            const t = now();
            var th: [2]std.Thread = undefined;
            const chunk = N / nt;
            for (0..nt) |i| {
                const r1 = if (i == nt - 1) N else (i + 1) * chunk;
                th[i] = try std.Thread.spawn(.{}, matvec, .{ Wq, Wd, x, y, i * chunk, r1 });
            }
            for (th[0..nt]) |h| h.join();
            best = @min(best, now() - t);
        }
        const bytes = N * BPR * 34;
        std.debug.print("threads={d} sweep={d:.2}ms  {d:.1} GB/s  ~{d:.0} tok/s-equiv\n", .{ nt, best * 1e3, @as(f64, @floatFromInt(bytes)) / best / 1e9, 1.0 / best });
    }

    // scalar reference (signed w = byte reinterpreted as i8)
    var maxrel: f64 = 0;
    var r: usize = 0;
    while (r < N) : (r += N / 97) {
        var acc: f64 = 0;
        for (0..BPR) |b| {
            var s: i64 = 0;
            for (0..32) |i| {
                const w: i8 = @bitCast(wb[r * K + b * 32 + i]);
                s += @as(i64, w) * xi[b * 32 + i];
            }
            acc += @as(f64, @floatFromInt(s)) * @as(f64, Wd[r * BPR + b]) * dx[b];
        }
        maxrel = @max(maxrel, @abs(acc - y[r]) / (@abs(acc) + 1e-3));
    }
    std.debug.print("rows={d} max_rel_err_vs_scalar={e}\n", .{ N, maxrel });
}
