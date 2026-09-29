// The orb shows your letters as you type. Each one is born from the orb and springs into a line
// below it; backspace takes the last one back into the orb; Enter sends them all into it (it keeps
// them). The only typing in the onboarding: your name, and one thing about you.

const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif';
const measure = document.createElement('canvas').getContext('2d');

/**
 * Ask for a few letters. `ui` gives the layer, the phone element, the hint element, the keyboard hook,
 * the orb (avatar) and sound; `skip` adds a quiet way out. Resolves with the text ('' if skipped).
 */
export function askLetters(ui, { hint, max = 24, skip = true, abort }) {
  const { layer, phone, hintEl, keys, avatar, sound, quietButton } = ui;
  const spans = [];   // { el, ch }
  let text = '', done = false, skipBtn = null;

  const box = () => phone.getBoundingClientRect();
  const orbAt = () => {
    const w = avatar.where(), b = box();
    return w ? { x: w.x - b.left, y: w.y - b.top } : { x: b.width / 2, y: b.height * 0.4 };
  };
  const size = () => (text.length <= 14 ? 38 : Math.max(22, 38 - (text.length - 14) * 0.6));

  // Lines: words wrap at 84% of the phone's width; each line centred, starting at 63% of its height.
  function layout() {
    const b = box(), px = size(), maxW = b.width * 0.84, lineH = px * 1.35;
    measure.font = `${px}px ${FONT}`;
    const lines = [[]];
    let w = 0;
    const words = text.split(/(?<= )/);   // keep the spaces with their words
    let i = 0;
    for (const word of words) {
      const ww = measure.measureText(word).width;
      if (w + ww > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; }
      for (const ch of word) { lines[lines.length - 1].push({ i: i++, w: measure.measureText(ch).width }); }
      w += ww;
    }
    const top = b.height * 0.63 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, li) => {
      const total = line.reduce((a, c) => a + c.w, 0);
      let x = (b.width - total) / 2;
      for (const c of line) {
        const s = spans[c.i];
        if (s) Object.assign(s.el.style, { left: `${x + c.w / 2}px`, top: `${top + li * lineH}px`, fontSize: `${px}px` });
        x += c.w;
      }
    });
    hintEl.style.top = `${top + lines.length * lineH + 6}px`;
  }

  function add(ch) {
    if (text.length >= max) return;
    const el = document.createElement('span');
    el.className = 'letter';
    el.textContent = ch === ' ' ? ' ' : ch;
    const o = orbAt();
    Object.assign(el.style, { left: `${o.x}px`, top: `${o.y}px`, opacity: '0', transform: 'translate(-50%, -50%) scale(0.2)' });
    layer.appendChild(el);
    spans.push({ el, ch });
    text += ch;
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.opacity = '1'; el.style.transform = 'translate(-50%, -50%) scale(1)';
    }));
    if (ch !== ' ') { sound.blip(ch); avatar.speak([0.5, 0.9, 0.6, 0.2], 20, 0); }
    hintEl.textContent = 'enter when you’re done';
  }

  function takeBack() {
    const s = spans.pop();
    if (!s) return;
    text = text.slice(0, -1);
    const o = orbAt();
    Object.assign(s.el.style, { left: `${o.x}px`, top: `${o.y}px`, opacity: '0', transform: 'translate(-50%, -50%) scale(0.2)' });
    setTimeout(() => s.el.remove(), 500);
    sound.blip(s.ch, true);
    layout();
    if (!text) hintEl.textContent = hint;
  }

  return new Promise((resolve, reject) => {
    const finish = value => {
      if (done) return;
      done = true; keys.handler = null;
      hintEl.classList.remove('on'); skipBtn?.remove();
      const o = orbAt();
      spans.forEach((s, k) => setTimeout(() => {   // into the orb, one after another
        Object.assign(s.el.style, { left: `${o.x}px`, top: `${o.y}px`, opacity: '0', transform: 'translate(-50%, -50%) scale(0.15)' });
        setTimeout(() => s.el.remove(), 500);
      }, k * 35));
      if (value) { sound.swallow(value.length); setTimeout(() => avatar.joy(), spans.length * 35 + 250); }
      setTimeout(() => resolve(value), spans.length * 35 + (value ? 600 : 200));
    };
    abort.then?.(() => { done = true; keys.handler = null; spans.forEach(s => s.el.remove()); skipBtn?.remove(); reject('abort'); });
    avatar.setEmotion('calm');   // it settles in the middle to watch your letters come out of it
    hintEl.textContent = hint; hintEl.classList.add('on');
    layout();
    if (skip) skipBtn = quietButton('skip', () => finish(''));
    keys.handler = ev => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'Enter') { if (text.trim()) finish(text.trim()); }
      else if (ev.key === 'Backspace') takeBack();
      else if (ev.key.length === 1 && (ev.key !== ' ' || (text && !text.endsWith(' ')))) add(ev.key);
      else return;
      ev.preventDefault();
    };
  });
}
