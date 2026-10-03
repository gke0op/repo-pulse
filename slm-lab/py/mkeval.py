import sys
s=open(sys.argv[1]).read()
calib=open('gcalib.txt').read().strip(); story=open('gstory.txt').read().strip()
a=s.index("    const prompt = [_]usize{"); b=s.index("    quit.store(true", a)
s=s[:a]+'''    const calib = [_]usize{ %s };
    const story = [_]usize{ %s };
    var hist: [6]usize = @splat(0);
    use_casc = true;
    check = true;
    var maxn: usize = 0;
    for (calib, 0..) |t, p| {
        const before = cand_total;
        forward(t, p);
        const n = cand_total - before;
        maxn = @max(maxn, n);
        const bin: usize = if (n <= 16) 0 else if (n <= 64) 1 else if (n <= 256) 2 else if (n <= 1024) 3 else if (n <= CAP) 4 else 5;
        hist[bin] += 1;
    }
    std.debug.print("teacher-forced {d} positions: mismatches={d}  candidates <=16:{d} <=64:{d} <=256:{d} <=1k:{d} <=16k:{d} fallback:{d}  max={d}\\n", .{ calib.len, n_mismatch, hist[0], hist[1], hist[2], hist[3], hist[4], hist[5], maxn });
    check = false;
    for (0..3) |rep| {
        for ([_]bool{ false, true }) |cmode| {
            use_casc = false;
            for (story, 0..) |t, p| forward(t, p);
            var tok = argmax();
            use_casc = cmode;
            const c0 = cand_total;
            var ngen: usize = 0;
            const t0 = now();
            while (ngen < 400 and tok != 106 and tok != 1) : (ngen += 1) {
                forward(tok, story.len + ngen);
                tok = if (use_casc) casc_best else argmax();
            }
            const dt = now() - t0;
            std.debug.print("rep{d} {s}: {d} tokens  {d:.1} tok/s", .{ rep, if (cmode) "cascade" else "full Q8", ngen, @as(f64, @floatFromInt(ngen)) / dt });
            if (cmode) std.debug.print("  mean cand={d:.0}", .{@as(f64, @floatFromInt(cand_total - c0)) / @as(f64, @floatFromInt(ngen))});
            std.debug.print("\\n", .{});
        }
    }
''' % (calib.replace(',', ', '), story.replace(',', ', '))+s[b:]
s=s.replace("    const want_casc = use_casc;","    _ = &use_casc;")
open(sys.argv[2],'w').write(s)
