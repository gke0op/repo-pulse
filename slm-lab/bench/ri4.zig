// ri.zig — row-interleaved Q8 matvec microbench vs current per-row layout.
// RI layout per 16-row group, per 32-col block: 8 chunks x 64B (chunk c: rows 0..15 x weights 4c..4c+3,
// stored as u8 = w+128), then 16 f16 scales (one per row). Same bytes as Q8_0 (34 per 32 weights).
const std = @import("std");
const linux = std.os.linux;
const V64u = @Vector(64, u8);
const V64i = @Vector(64, i8);
const V16i = @Vector(16, i32);
const V16f = @Vector(16, f32);
const V16h = @Vector(16, f16);

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

const K: usize = 640;
const NB = K / 32;
const BB = 256 + 32; // Q4: 4x64B nibble vectors + 16 f16 scales per 32-col block
const GB = NB * BB; // bytes per 16-row group

// x: int8 [K], per-block scale xd[NB], block sums sx[NB]
fn riRows(W: [*]const u8, x: [*]const i8, xd: [*]const f32, sx: [*]const i32, y: [*]f32, g0: usize, g1: usize) void {
    var g = g0;
    while (g < g1) : (g += 1) {
        const gp = W + g * GB;
        if (g + 2 < g1) {
            var c: usize = 0;
            while (c < GB) : (c += 64) @prefetch(W + (g + 2) * GB + c, .{});
        }
        var acc: V16f = @splat(0);
        const m4: V64u = @splat(0x0F);
        for (0..NB) |b| {
            const bp = gp + b * BB;
            var ai: V16i = @splat(-8 * sx[b]);
            inline for (0..4) |k| {
                const v: V64u = @as(*const [64]u8, @ptrCast(bp + k * 64)).*;
                const x0: u32 = @bitCast(x[b * 32 + k * 8 ..][0..4].*);
                const x1: u32 = @bitCast(x[b * 32 + k * 8 + 4 ..][0..4].*);
                ai = dpbusd(ai, v & m4, @bitCast(@as(V16i, @splat(@bitCast(x0)))));
                ai = dpbusd(ai, (v >> @splat(4)) & m4, @bitCast(@as(V16i, @splat(@bitCast(x1)))));
            }
            const sc: V16f = @floatCast(@as(V16h, @as(*const [16]f16, @ptrCast(@alignCast(bp + 256))).*));
            acc = @mulAdd(V16f, @floatFromInt(ai), sc * @as(V16f, @splat(xd[b])), acc);
        }
        y[g * 16 ..][0..16].* = acc;
    }
}

pub fn main() !void {
    const alloc = std.heap.page_allocator;
    for ([_]usize{ 262144, 1048576 * 2 }) |N| {
        const G = N / 16;
        const W = try alloc.alignedAlloc(u8, .@"64", G * GB);
        defer alloc.free(W);
        var seed: u32 = 7;
        for (W) |*b| {
            seed = seed *% 1664525 +% 1013904223;
            b.* = @truncate(seed >> 24);
        }
        // valid f16 scales
        for (0..G) |g| for (0..NB) |b| {
            const sp: *[16]f16 = @ptrCast(@alignCast(W.ptr + g * GB + b * BB + 256));
            for (sp, 0..) |*s, j| s.* = @floatCast(0.004 + 0.0001 * @as(f32, @floatFromInt((g + b + j) % 50)));
        };
        var x: [K]i8 = undefined;
        for (&x) |*v| {
            seed = seed *% 1664525 +% 1013904223;
            v.* = @bitCast(@as(u8, @truncate(seed >> 24)));
        }
        var xd: [NB]f32 = undefined;
        var sx: [NB]i32 = undefined;
        for (0..NB) |b| {
            xd[b] = 0.01 + 0.001 * @as(f32, @floatFromInt(b));
            var s: i32 = 0;
            for (x[b * 32 ..][0..32]) |v| s += v;
            sx[b] = s;
        }
        const y = try alloc.alloc(f32, N);
        defer alloc.free(y);
        for ([_]usize{ 1, 2 }) |nt| {
            var best: f64 = 1e9;
            for (0..5) |_| {
                const t = now();
                var th: [2]std.Thread = undefined;
                for (0..nt) |i| th[i] = try std.Thread.spawn(.{}, riRows, .{ W.ptr, &x, &xd, &sx, y.ptr, G * i / nt, G * (i + 1) / nt });
                for (th[0..nt]) |h| h.join();
                best = @min(best, now() - t);
            }
            const bytes: f64 = @floatFromInt(G * GB);
            std.debug.print("RI Q4  rows={d} ({d:.0} MB) threads={d}: {d:.2} ms  {d:.1} GB/s  {d:.1} Gweights/s\n", .{ N, bytes / 1e6, nt, best * 1e3, bytes / best / 1e9, @as(f64, @floatFromInt(N * K)) / best / 1e9 });
        }
        // scalar check on a few rows
        var maxrel: f64 = 0;
        var r: usize = 0;
        while (r < N) : (r += N / 37 + 1) {
            const g = r / 16;
            const j = r % 16;
            var acc: f64 = 0;
            for (0..NB) |b| {
                var s: i64 = 0;
                for (0..32) |i| {
                    const k = i / 8;
                    const byte = W[g * GB + b * BB + k * 64 + j * 4 + i % 4];
                    const code: i64 = if ((i / 4) % 2 == 0) byte & 15 else byte >> 4;
                    s += (code - 8) * x[b * 32 + i];
                }
                const sp: *const [16]f16 = @ptrCast(@alignCast(W.ptr + g * GB + b * BB + 256));
                acc += @as(f64, @floatFromInt(s)) * @as(f64, sp[j]) * xd[b];
            }
            maxrel = @max(maxrel, @abs(acc - y[r]) / (@abs(acc) + 1e-3));
        }
        std.debug.print("   max rel err vs scalar = {e}\n", .{maxrel});
    }
}
