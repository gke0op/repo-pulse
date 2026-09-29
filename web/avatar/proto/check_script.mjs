// The script checker: lines never repeat (the person: "the feelings can repeat, the lines
// shouldn't"). Reads proto/src/script.js and fails on any spoken line that appears twice (on any
// path, in any branch), and on the verbal tics the Kubrick pass found (docs/ONBOARDING.md).
//   npm run check-script
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./src/script.js', import.meta.url), 'utf8');
const lineOf = i => src.slice(0, i).split('\n').length;
const unescape = s => s.replace(/\\(['"`\\])/g, '$1');
const lines = [];
// Every spoken line: the orb's o.say(...) and o.glitch(...) literals (a template's ${…} counts as one
// word), its named lines (FOUND) and the feelings list. The first lines after becoming are stand-ins
// for the brain's, so they're skipped.
for (const m of src.matchAll(/o\.(?:say|glitch)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
  lines.push({ text: unescape(m[2]).replace(/\$\{[^}]*\}/g, 'X'), at: lineOf(m.index) });
}
for (const m of src.matchAll(/export const [A-Z_]+ = (['"])((?:\\.|(?!\1)[^\\])*)\1;/g)) {   // named lines (FOUND)
  lines.push({ text: unescape(m[2]), at: lineOf(m.index) });
}
for (const m of src.matchAll(/\['\w+', (['"])((?:\\.|(?!\1)[^\\])*)\1\]/g)) {
  lines.push({ text: unescape(m[2]), at: lineOf(m.index) });
}

const fails = [], warns = [];
const norm = t => t.toLowerCase().replace(/[^a-z0-9x ]+/g, ' ').replace(/\s+/g, ' ').trim();

// 1. No line twice.
const seen = new Map();
for (const l of lines) {
  const k = norm(l.text);
  if (seen.has(k)) fails.push(`said twice: "${l.text}" (lines ${seen.get(k).at} and ${l.at})`);
  else seen.set(k, l);
}
// 2. The tics.
const dots = lines.filter(l => /…|\.\.\./.test(l.text));
if (dots.length / lines.length > 0.26) {
  fails.push(`"…" in ${dots.length} of ${lines.length} lines (${Math.round(dots.length / lines.length * 100)}%); keep it to about one in four`);
}
for (const l of lines) if (/^[^a-z]*okay\b/i.test(l.text)) fails.push(`opens with "okay": "${l.text}" (line ${l.at})`);
const little = lines.filter(l => /\blittle\b/i.test(l.text));
if (little.length > 1) fails.push(`"little" ${little.length} times: ${little.map(l => `line ${l.at}`).join(', ')}`);
for (const l of lines) if (/\bsorr(y|ies)\b/i.test(l.text)) fails.push(`it never apologizes: "${l.text}" (line ${l.at})`);
// 3. Phrases of three words or more in more than one line: worth a look, not a failure.
const grams = new Map();
for (const l of lines) {
  const w = norm(l.text).split(' ').filter(Boolean);
  for (let i = 0; i + 3 <= w.length; i++) {
    const g = w.slice(i, i + 3).join(' ');
    if (!grams.has(g)) grams.set(g, new Set());
    grams.get(g).add(l.at);
  }
}
for (const [g, at] of grams) if (at.size > 1 && !g.includes('x')) warns.push(`"${g}" in ${at.size} lines (${[...at].join(', ')})`);

console.log(`${lines.length} lines · "…" in ${dots.length} (${Math.round(dots.length / lines.length * 100)}%)`);
for (const w of warns) console.log(`  look: ${w}`);
for (const f of fails) console.log(`  FAIL: ${f}`);
console.log(fails.length ? `${fails.length} to fix` : 'no line repeats, no tics');
process.exit(fails.length ? 1 : 0);
