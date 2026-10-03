import sys
s=open(sys.argv[1]).read()
def R(a,b,n=1):
    global s
    assert s.count(a)==n,(a,s.count(a)); s=s.replace(a,b)
R("var t_mv: f64 = 0;\n","""var t_mv: f64 = 0;
var cls: usize = 0;
var tp: [5]f64 = @splat(0);
var tc: [5]f64 = @splat(0);
var tw: [5]f64 = @splat(0);
var twk: [5]f64 = @splat(0);
var t_att: f64 = 0;
var t_am: f64 = 0;
""")
R("        seen +%= 1;\n        runShare(tid);\n","        seen +%= 1;\n        const tk = now();\n        runShare(tid);\n        if (!job.attn) twk[cls] += now() - tk;\n")
_a=s.index("fn dispatch(src: []const f32"); _b=s.index("    job.n = ws.len;\n",_a)
s=s[:_b]+"    const t1 = now();\n    tp[cls] += t1 - ts;\n"+s[_b:]
R("    runShare(0);\n    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();\n}","    runShare(0);\n    const t2 = now();\n    tc[cls] += t2 - t1;\n    while (done.load(.acquire) < NT - 1) std.atomic.spinLoopHint();\n    tw[cls] += now() - t2;\n}")
R("        dispatch(&hb, &.{ w.wq,","        cls = 0;\n        dispatch(&hb, &.{ w.wq,")
R("        rope(&qv);\n","        const ta = now();\n        rope(&qv);\n")
R("        dispatch(&att, &.{w.wo}","        t_att += now() - ta;\n        cls = 1;\n        dispatch(&att, &.{w.wo}")
R("        dispatch(&hb, &.{ w.wg,","        cls = 2;\n        dispatch(&hb, &.{ w.wg,")
R("        dispatch(&g, &.{w.wd}","        cls = 3;\n        dispatch(&g, &.{w.wd}")
R("    dispatch(&hb, &.{emb}","    cls = 4;\n    dispatch(&hb, &.{emb}")
R("fn argmax() usize {\n","fn argmax() usize {\n    const ts = now();\n    defer t_am += now() - ts;\n")
a=s.index("    // greedy decode, timed"); b=s.index("    quit.store(true", a)
s=s[:a]+'''    const NG = 64;
    for ([_]usize{ 16, 448, 896 }) |ctx| {
        var p: usize = prompt.len;
        while (p < ctx) : (p += 1) forward(prompt[p % prompt.len], p);
        tp = @splat(0); tc = @splat(0); tw = @splat(0); twk = @splat(0); t_att = 0; t_am = 0;
        var tok = argmax0;
        const t0 = now();
        for (0..NG) |i| {
            forward(tok, ctx + i);
            tok = argmax();
        }
        const dt = (now() - t0) / NG * 1e6;
        const names = [_][]const u8{ "qkv", "o", "gate+up", "down", "head" };
        var mvsum: f64 = 0;
        std.debug.print("\\n== ctx {d}..{d}: {d:.0} us/tok = {d:.0} tok/s\\n", .{ ctx, ctx + NG, dt, 1e6 / dt });
        for (0..5) |c| {
            const tot = (tp[c] + tc[c] + tw[c]) / NG * 1e6;
            mvsum += tot;
            std.debug.print("  {s:8} {d:6.0} us ({d:4.1}%)  prep={d:4.0} main={d:5.0} wait={d:4.0} worker={d:5.0}\\n", .{ names[c], tot, tot / dt * 100, tp[c] / NG * 1e6, tc[c] / NG * 1e6, tw[c] / NG * 1e6, twk[c] / NG * 1e6 });
        }
        const att_us = t_att / NG * 1e6;
        const am_us = t_am / NG * 1e6;
        std.debug.print("  attn     {d:6.0} us ({d:4.1}%)\\n  argmax   {d:6.0} us\\n  other    {d:6.0} us\\n", .{ att_us, att_us / dt * 100, am_us, dt - mvsum - att_us - am_us });
    }
'''+s[b:]
open(sys.argv[2],'w').write(s)
