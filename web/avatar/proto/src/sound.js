// Sound for the onboarding prototype, all offline:
//  - babble: the orb's wordless voice before it has one, synthesized here (no model). One soft,
//    continuous voice per line: it glides from syllable to syllable (it never beeps), wavers a
//    little like a held note, breathes, and its vowels colour it gently; its tune follows the
//    feeling and the punctuation (a question rises, a full stop falls). The person: the first,
//    beep-per-syllable take "sounds robotic"; the hum is the one they liked.
//  - after it has a voice: the app's real one (Supertonic 3, the same model files, run on the Mac by
//    voice_server.py), with the app's speakers per character. The orb's own voice doesn't exist yet,
//    so it borrows a speaker (5 by default: 158 Hz, in the gap between the female and male voices).
//    Without the model, the system's own offline speech stands in.
//  - the ears: the microphone's loudness, so the orb can pulse with your voice.

const VOWELS = { a: [800, 1250], e: [520, 1900], i: [330, 2350], o: [520, 950], u: [360, 850], y: [330, 2100] };
// One key for every tonal sound (the Kubrick pass): C major pentatonic, C D E G A, so nothing it
// sings is ever sour and everything sounds like one piece. A degree counts up that scale from C3:
// 0 = C3, 5 = C4, 10 = C5, 15 = C6. (Its speech, the babble, isn't tuned: speech isn't song.)
const SCALE = [0, 2, 4, 7, 9];
export const note = d => 130.81 * 2 ** ((12 * Math.floor(d / 5) + SCALE[((d % 5) + 5) % 5]) / 12);

export const STYLES = {
  // f0: base Hz · glide: pitch movement in a syllable · syl: syllable seconds · lp: tone (lowpass Hz)
  // body: a little triangle under the sine · breath: air · attack/release: how softly it swells
  // colour: vowel colouring · loud: level
  hum: { f0: 250, glide: 0.18, syl: 0.15, lp: 1100, body: 0.25, breath: 0.03, attack: 0.03, release: 0.05, colour: 1.0, loud: 0.34 },
  coo: { f0: 390, glide: 0.3, syl: 0.13, lp: 1700, body: 0.1, breath: 0.03, attack: 0.025, release: 0.045, colour: 0.7, loud: 0.3 },
  chirp: { f0: 560, glide: 0.4, syl: 0.1, lp: 2800, body: 0.04, breath: 0.02, attack: 0.015, release: 0.035, colour: 0.5, loud: 0.26 },
};
// pitch ×, tune range ×, tempo ×, loudness ×
const FEEL = {
  calm: [1, 1, 1, 1], happy: [1.15, 1.5, 1.12, 1.1], sad: [0.85, 0.5, 0.8, 0.8], angry: [0.8, 0.7, 1.1, 1.2],
  surprised: [1.3, 1.8, 1.15, 1.15], curious: [1.08, 1.3, 1, 1], tender: [0.95, 0.7, 0.85, 0.85],
};
const PAUSE = { ',': 0.16, '.': 0.3, '!': 0.3, '?': 0.32, '…': 0.45, ':': 0.2, ';': 0.2 };

/** A line's syllables: vowel groups per word, each with the text it reveals and the pause after it. */
export function syllables(text) {
  const out = [];
  for (const m of text.matchAll(/\S+/g)) {
    const word = m[0], at = m.index;
    const groups = [...word.matchAll(/[aeiouy]+/gi)];
    const tail = word.match(/(\.\.\.|[,.!?…:;])+$/)?.[0] ?? '';
    const mark = tail.includes('?') ? '?' : tail.includes('!') ? '!' : tail.includes('…') || tail.includes('...') ? '…' : tail.slice(-1);
    const pause = (PAUSE[mark] ?? 0) + 0.045;
    if (!groups.length && !/[a-z0-9]/i.test(word)) {   // "…" or "—" alone: only a pause
      if (out.length) { out[out.length - 1].pause += pause; out[out.length - 1].to = at + word.length; }
      continue;
    }
    const starts = [0, ...groups.slice(1).map(g => g.index)];
    starts.forEach((s, i) => out.push({
      to: at + (i + 1 < starts.length ? starts[i + 1] : word.length),
      vowel: (groups[i]?.[0][0] ?? 'a').toLowerCase(),
      pause: i + 1 < starts.length ? 0 : pause,
      mark: i + 1 < starts.length ? '' : mark,
    }));
  }
  return out;
}

// Who speaks with which of the app's speakers, at which speed (Characters.kt, Voice.kt).
export const CAST = {
  orb: { speed: 1 }, girl: { sid: 1, speed: 1 }, boy: { sid: 6, speed: 1 }, machine: { sid: 9, speed: 0.92, robot: true },
};

// The orb's own voice is found, not given (the person): dragging it up and down walks these stops,
// the ten speakers from highest to deepest (measured with YIN over three lines: 3 at 220 Hz ... 9 at
// 86 Hz) with a half-and-half blend between each pair. The middle, 4 and 5 blended (~150 Hz), is the
// most androgynous; it's the voice it keeps if nobody helps it choose.
export const PATH = [3, 1, 2, 0, 4, 5, 8, 7, 6, 9];
export const STOPS = PATH.flatMap((a, i) => (i + 1 < PATH.length ? [{ a, b: a, t: 0 }, { a, b: PATH[i + 1], t: 0.5 }] : [{ a, b: a, t: 0 }]));
export const MIDDLE = STOPS.findIndex(v => v.a === 4 && v.b === 5);
/** A voice as the voice server wants it: a speaker id, or a blend of two. */
export function voiceQuery(v) {
  if (typeof v === 'number') return { sid: String(v) };
  return v.a === v.b || !v.t ? { sid: String(v.a) } : { mix: `${v.a},${v.b},${v.t}` };
}
export const voiceName = v => (typeof v === 'number' ? `speaker ${v}` : v.a === v.b || !v.t ? `speaker ${v.a}` : `${v.a} and ${v.b}, blended`);
const PROBE = 'is this me?';

export class Sound {
  constructor() {
    this.ctx = null; this.style = 'hum'; this.voices = []; this.model = null; this.orbVoice = null; this.playing = null;
    const load = () => { this.voices = (speechSynthesis?.getVoices?.() || []).filter(v => v.localService && /^en/i.test(v.lang)); };
    if (window.speechSynthesis) { load(); speechSynthesis.addEventListener?.('voiceschanged', load); }
  }

  /** Audio needs a touch first (browsers): call from a pointer event. */
  unlock() {
    if (!this.ctx) this.setup(new (window.AudioContext || window.webkitAudioContext)());
    this.ctx.resume?.();
  }

  /** The chain: everything -> a gentle compressor (nothing pokes out) -> out, plus a soft room. */
  setup(ctx) {
    const c = this.ctx = ctx;
    this.master = c.createDynamicsCompressor();
    this.master.threshold.value = -20; this.master.ratio.value = 3; this.master.knee.value = 12;
    this.master.attack.value = 0.01; this.master.release.value = 0.2;
    const out = c.createGain(); out.gain.value = 0.55;   // the compressor adds make-up gain
    this.master.connect(out); out.connect(c.destination);
    const room = c.createConvolver(), wet = c.createGain();   // a generated room tail instead of an echo
    const len = Math.round(c.sampleRate * 1.1), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp = 0.6 * lp + 0.4 * (Math.random() * 2 - 1); d[i] = lp * Math.exp(-i / (c.sampleRate * 0.28)); }
    }
    room.buffer = ir; wet.gain.value = 0.14;
    this.master.connect(room); room.connect(wet); wet.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);   // soft (brown-ish) noise: breath, not hiss
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    this.newBus();
  }
  newBus() { this.bus = this.ctx.createGain(); this.bus.connect(this.master); }

  /** Silence everything in flight (a restart). */
  stop() {
    if (this.ctx) { this.bus.disconnect(); this.newBus(); }
    try { this.playing?.stop(); } catch { /* already ended */ }
    this.playing = null;
    this.charge(false);
    this.stopProbe();
    window.speechSynthesis?.cancel();
  }

  /**
   * Sing a plan ([{t, dur, f, f2, vowel, loud, joined}]) as one continuous voice: a sine (with a
   * little triangle under it) gliding between the syllables' pitches, through a warm lowpass and two
   * gentle vowel colourings, with breath mixed in; each syllable swells and eases, and syllables
   * joined in a word only dip between them.
   */
  voice(plan, st, shape = 1, at = this.ctx.currentTime + 0.06) {
    if (!plan.length) return;
    const c = this.ctx, last = plan[plan.length - 1];
    const osc = c.createOscillator(), body = c.createOscillator(), bodyG = c.createGain();
    osc.type = 'sine'; body.type = 'triangle'; bodyG.gain.value = st.body;
    const lfo = c.createOscillator(), wob = c.createGain();
    lfo.frequency.value = 4.6 + Math.random() * 1.2;
    const lp = c.createBiquadFilter(), v1 = c.createBiquadFilter(), v2 = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = st.lp; lp.Q.value = 0.4;
    v1.type = v2.type = 'peaking'; v1.Q.value = 1.3; v2.Q.value = 1.6;
    v1.gain.value = 6 * st.colour * shape; v2.gain.value = 4 * st.colour * shape;
    const air = c.createBufferSource(), airF = c.createBiquadFilter(), airG = c.createGain();
    air.buffer = this.noise; air.loop = true;
    airF.type = 'bandpass'; airF.frequency.value = 1400; airF.Q.value = 0.6; airG.gain.value = st.breath;
    const amp = c.createGain();
    osc.connect(lp); body.connect(bodyG); bodyG.connect(lp); lp.connect(v1); v1.connect(v2); v2.connect(amp);
    air.connect(airF); airF.connect(airG); airG.connect(amp);
    lfo.connect(wob); wob.connect(osc.frequency); wob.connect(body.frequency);
    amp.connect(this.bus);
    const [F1, F2] = VOWELS[plan[0].vowel] || VOWELS.a;
    for (const fr of [osc.frequency, body.frequency]) fr.setValueAtTime(plan[0].f, at);
    v1.frequency.setValueAtTime(F1 * 1.2, at); v2.frequency.setValueAtTime(F2 * 1.2, at);
    wob.gain.setValueAtTime(plan[0].f * 0.006, at);
    amp.gain.setValueAtTime(0, at);
    for (const p of plan) {
      const T = at + p.t, [f1, f2] = VOWELS[p.vowel] || VOWELS.a;
      for (const fr of [osc.frequency, body.frequency]) {
        fr.setTargetAtTime(p.f, T, 0.03);
        fr.setTargetAtTime(p.f2, T + p.dur * 0.45, 0.07);
      }
      v1.frequency.setTargetAtTime(f1 * 1.2, T, 0.03); v2.frequency.setTargetAtTime(f2 * 1.2, T, 0.03);
      amp.gain.setTargetAtTime(p.loud, T, st.attack);
      amp.gain.setTargetAtTime(p.joined ? p.loud * 0.35 : 0, T + p.dur * 0.7, st.release);
    }
    const end = at + last.t + last.dur + 0.6;
    for (const n of [osc, body, lfo, air]) { n.start(at); n.stop(end); }
  }

  /**
   * Babble a line. Returns its plan: total seconds, the lip-sync envelope (20 ms frames) and when each
   * part of the text is said ({at seconds, to char index}), so the words can appear as it babbles.
   */
  babble(text, feel = 'calm', { shape = 1 } = {}) {
    const st = STYLES[this.style] || STYLES.hum, [pm, cm, tm, lm] = FEEL[feel] || FEEL.calm;
    const syl = syllables(text), plan = [];
    let t = 0;
    syl.forEach((s, i) => {
      const last = s.mark === '?' || s.mark === '!' || s.mark === '.';
      const dur = st.syl * (0.8 + 0.4 * Math.random()) / tm * (last ? 1.3 : 1);
      const decline = 1 - 0.12 * (i / Math.max(1, syl.length - 1));
      let f = st.f0 * pm * decline * (1 + (Math.random() - 0.5) * 0.2 * cm);
      let f2 = f * (1 + (Math.random() - 0.5) * st.glide * cm);
      let loud = st.loud * lm * (0.8 + 0.2 * Math.random());
      if (s.mark === '?') f2 = f * 1.45;
      if (s.mark === '!') { f *= 1.12; f2 = f * 1.08; loud *= 1.15; }
      if (s.mark === '.') f2 = f * 0.85;
      plan.push({ t, dur, f, f2, vowel: s.vowel, loud, joined: s.pause === 0, to: s.to });
      t += dur + s.pause / tm;
    });
    if (this.ctx) this.voice(plan, st, shape);
    return { total: t, env: this.envelope(plan, st.loud), reveal: plan.map(p => ({ at: p.t, to: p.to })) };
  }

  // The lip-sync envelope (20 ms frames) of a plan: one bump per note.
  envelope(plan, ref) {
    const env = [];
    for (const p of plan) {
      const a = Math.round(p.t / 0.02), n = Math.max(2, Math.round(p.dur / 0.02));
      while (env.length < a) env.push(0);
      for (let k = 0; k < n; k++) env[a + k] = Math.min(1, (p.loud / ref) * 0.75 * Math.sin(Math.PI * (k + 0.5) / n));
    }
    return env;
  }

  /**
   * Humming while it wakes a piece of itself, as the progress p (0..1) grows: from a sleepy, low,
   * lips-closed "mm", one note at a time, to little tunes that climb and open ("ooh", then "aah"),
   * the phrases getting longer, livelier and more voice-like, ending a step up (looking up). The ears
   * hum higher, perking up like a question. Every note is in the key. Returns its length and envelope.
   */
  hum(p, kind = 'voice') {
    if (!this.ctx) return { total: 0.3, env: [] };
    const base = (kind === 'ears' ? 5 : 3) + Math.round(p * 3);   // G3 (C4 for the ears), climbing with progress
    const n = p < 0.2 ? 1 : p < 0.5 ? 2 : p < 0.8 ? 3 : 4;
    const vowel = kind === 'ears' ? (p < 0.5 ? 'e' : 'i') : p < 0.33 ? 'u' : p < 0.66 ? 'o' : 'a';
    let step = this.humStep ?? 1, t = 0;
    const plan = [];
    for (let k = 0; k < n; k++) {
      if (k) step = Math.max(0, Math.min(7, step + [-1, 1, 1, 2, -2][Math.floor(Math.random() * 5)]));
      const last = k === n - 1, f = note(base + step);
      const f2 = last && (kind === 'ears' || p > 0.6) ? note(base + step + 1) : f * (1 + (1 - p) * 0.03 * (Math.random() - 0.5));
      const dur = (0.26 - 0.1 * p) * (last ? 1.4 : 1) * (0.85 + 0.3 * Math.random());
      plan.push({ t, dur, f, f2, vowel, loud: 0.13 + 0.12 * p, joined: !last });
      t += dur;
    }
    this.humStep = step;
    this.voice(plan, { ...STYLES.hum, attack: 0.04 + 0.03 * (1 - p), release: 0.08 }, 0.3 + 0.7 * p);
    return { total: t, env: this.envelope(plan, 0.25) };
  }

  /** A soft glass bell: inharmonic partials, each fading at its own pace. */
  bell(f, at, loud = 0.1) {
    const c = this.ctx;
    for (const [ratio, amp, decay] of [[1, 1, 1.3], [2.76, 0.32, 0.6], [5.4, 0.1, 0.28]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(loud * amp, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      o.connect(g); g.connect(this.bus);
      o.start(at); o.stop(at + decay + 0.05);
    }
  }

  // A soft held chord on scale degrees (two slightly detuned sines per note: warm), swelling in and
  // away over `len` seconds.
  pad(degrees, at, len) {
    const c = this.ctx, g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.08, at + len * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(this.bus);
    for (const d of degrees) {
      for (const cents of [-3, 3]) {
        const o = c.createOscillator();
        o.type = 'sine'; o.frequency.value = note(d); o.detune.value = cents;
        o.connect(g); o.start(at); o.stop(at + len + 0.05);
      }
    }
  }

  /**
   * The leitmotif: glass bells climbing C E G C (the Kubrick pass). 'small' at each waking; 'half'
   * (C E G, slower, left unresolved) when it can think; 'whole' once, at the becoming (C G C E G C,
   * slow, over a low C and G swelling underneath, with a long hummed "aah"). The same notes each time,
   * so the last one is recognised.
   */
  motif(size = 'small') {
    if (!this.ctx) return { total: 0, env: [] };
    const m = {
      small: { notes: [10, 12, 13, 15], gap: 0.085, loud: 0.09, hum: [0.12, 0.55, 0.15], tail: 0.6 },
      half: { notes: [10, 12, 13], gap: 0.2, loud: 0.11, hum: [0.2, 0.9, 0.16], tail: 1.1 },
      whole: { notes: [5, 8, 10, 12, 13, 15], gap: 0.34, loud: 0.13, hum: [0.5, 2.2, 0.2], tail: 2.6 },
    }[size];
    const at = this.ctx.currentTime + 0.05;
    m.notes.forEach((d, k) => this.bell(note(d), at + k * m.gap, size === 'small' ? m.loud - k * 0.008 : m.loud));
    const [ht, hdur, hl] = m.hum;
    const plan = [{ t: ht, dur: hdur, f: note(5), f2: note(5) * 1.01, vowel: 'a', loud: hl, joined: false }];
    this.voice(plan, STYLES.hum, 1);
    if (size === 'whole') this.pad([0, 3], at, 4.5);
    return { total: m.notes.length * m.gap + m.tail, env: this.envelope(plan, hl) };
  }

  /** Awake: the leitmotif, small. */
  arrive() { return this.motif('small'); }

  /** It starts listening: a soft "hm?", rising in the key. */
  listenCue() {
    if (!this.ctx) return;
    this.voice([
      { t: 0, dur: 0.12, f: note(3), f2: note(3), vowel: 'u', loud: 0.12, joined: true },
      { t: 0.13, dur: 0.22, f: note(4), f2: note(5), vowel: 'i', loud: 0.14, joined: false },
    ], STYLES.hum, 1);
  }

  /** A tap: a soft round "boop" (a drop of water), climbing the scale when the taps come quickly. */
  boop(streak = 0) {
    if (!this.ctx) return;
    const c = this.ctx, at = c.currentTime + 0.005, f = note(12 + Math.min(streak, 6));
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.05);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(g); g.connect(this.bus);
    o.start(at); o.stop(at + 0.25);
  }

  /** Held: a soft tone rising an octave (C4 to C5) while you hold it; let go and it fades. */
  charge(on, secs = 1.2) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    if (on && !this.charging) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'sine'; o2.type = 'triangle';
      for (const x of [o, o2]) { x.frequency.setValueAtTime(note(5), now); x.frequency.linearRampToValueAtTime(note(10), now + secs); }
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g2 = c.createGain(); g2.gain.value = 0.2;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.13, now + 0.08);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.bus);
      o.start(now); o2.start(now);
      this.charging = { o, o2, g };
    } else if (!on && this.charging) {
      const { o, o2, g } = this.charging;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      o.stop(now + 0.2); o2.stop(now + 0.2);
      this.charging = null;
    }
  }

  /** A wordless little sound for a feeling (the feelings tour), in the key. */
  emote(feeling) {
    if (!this.ctx) return null;
    const N = (t, dur, f, f2, vowel, loud, joined = true) => ({ t, dur, f, f2, vowel, loud, joined });
    const plan = {
      happy: [N(0, 0.12, note(7), note(7), 'a', 0.26), N(0.13, 0.12, note(8), note(8), 'a', 0.28), N(0.26, 0.28, note(10), note(11), 'a', 0.3, false)],
      curious: [N(0, 0.2, note(3), note(3), 'u', 0.22), N(0.24, 0.34, note(4), note(6), 'i', 0.25, false)],
      surprised: [N(0, 0.32, note(8), note(11), 'o', 0.32, false)],
      sad: [N(0, 0.45, note(7), note(6), 'u', 0.18), N(0.5, 0.7, note(5), note(4), 'u', 0.15, false)],
      angry: [N(0, 0.16, note(1), note(1), 'o', 0.32), N(0.2, 0.3, note(1), note(0), 'o', 0.3, false)],
      tender: [N(0, 1.1, note(4), note(4) * 1.01, 'u', 0.16, false)],
    }[feeling];
    if (!plan) return null;
    this.voice(plan, { ...STYLES.hum, attack: 0.05, release: 0.09 }, 1);
    return { env: this.envelope(plan, 0.3) };
  }

  // A soft pluck (a kalimba-like sine with a faint octave), for the letters.
  pluck(f, at, loud = 0.2, len = 0.4) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), g2 = c.createGain();
    o.type = o2.type = 'sine'; o2.frequency.value = f * 2.01; g2.gain.value = 0.1;
    o.frequency.setValueAtTime(f * 1.02, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.04);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(loud, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2500;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); lp.connect(this.bus);
    o.start(at); o2.start(at); o.stop(at + len + 0.05); o2.stop(at + len + 0.05);
  }

  /** A letter being born from the orb (or taken back, down = true, two steps lower): in the key. */
  blip(ch, down = false) {
    if (!this.ctx) return;
    const d = 10 + ((ch.toLowerCase().charCodeAt(0) * 7) % 10);
    this.pluck(note(down ? d - 2 : d), this.ctx.currentTime + 0.005, 0.17, down ? 0.25 : 0.45);
  }

  /** Letters going into the orb: a little rising run (C E G, up two octaves). */
  swallow(n) {
    if (!this.ctx) return;
    for (let k = 0; k < Math.min(n, 8); k++) {
      this.pluck(note([10, 12, 13, 15, 17, 18, 20, 22][k]), this.ctx.currentTime + 0.02 + k * 0.055, 0.14, 0.5);
    }
  }

  // ---- the real voice: the app's Supertonic 3, from the prototype's voice server ---------------
  /** Is the app's voice here? Resolves to the HTTP status (404: no model on this Mac; 503: starting). */
  async checkModel() {
    try {
      const r = await fetch('tts-health');
      this.model = r.ok ? await r.json() : null;
      return r.status;
    } catch { this.model = null; return 0; }
  }

  /**
   * Say a line in the app's own voice: fetch it, play it, and drive the lip-sync (20 ms loudness
   * frames) and the words' reveal from the real audio. Resolves when it has been said.
   */
  /** The voice server's URL for a line in a voice (a speaker id, or a blend). */
  ttsUrl(text, voice, { speed = 1, robot = false } = {}) {
    return `tts?${new URLSearchParams({ text, ...voiceQuery(voice), speed: String(speed), robot: robot ? '1' : '0' })}`;
  }

  /** A line in a voice, decoded (kept, so a probe or a replay is instant). */
  fetchBuffer(text, voice, opts) {
    this.unlock();
    const url = this.ttsUrl(text, voice, opts);
    this.buffers ??= new Map();
    if (!this.buffers.has(url)) {
      this.buffers.set(url, fetch(url).then(r => {
        if (!r.ok) throw new Error(`voice: ${r.status}`);
        return r.arrayBuffer();
      }).then(b => this.ctx.decodeAudioData(b)).catch(e => { this.buffers.delete(url); throw e; }));
    }
    return this.buffers.get(url);
  }

  // Loudness in 20 ms frames, for the lip-sync.
  envelopeOf(buf) {
    const x = buf.getChannelData(0), per = Math.round(buf.sampleRate * 0.02), env = [];
    for (let i = 0; i < x.length; i += per) {
      let e = 0;
      for (let k = i; k < Math.min(x.length, i + per); k++) e += x[k] * x[k];
      env.push(Math.sqrt(e / per));
    }
    const top = Math.max(1e-4, ...env);
    return env.map(v => Math.min(1, (v / top) ** 0.7));
  }

  // Play a decoded line, driving the lip-sync and the words' reveal; resolves when it's been said.
  play(buf, text, { onStart, onReveal } = {}) {
    if (!this.voiceOut) { this.voiceOut = this.ctx.createGain(); this.voiceOut.connect(this.ctx.destination); }
    try { this.playing?.stop(); } catch { /* already ended */ }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.voiceOut);
    this.playing = src;
    const envelope = this.envelopeOf(buf);
    return new Promise(res => {
      const t0 = performance.now();
      const tick = setInterval(() => onReveal?.(Math.floor(text.length * Math.min(1, (performance.now() - t0) / 1000 / buf.duration))), 60);
      src.onended = () => { clearInterval(tick); if (this.playing === src) this.playing = null; res(); };
      onStart?.(envelope);
      src.start();
    });
  }

  /**
   * A voice that isn't settled yet: the line made in several voices and spliced back together, a
   * slice from one, then another (a radio between stations), with stutters, dropouts and a crunch.
   * amount 0..1: how unsettled.
   */
  async speakGlitch(text, voices, { amount = 1, onStart, onReveal } = {}) {
    const bufs = await Promise.all(voices.map(v => this.fetchBuffer(text, v)));
    const sr = bufs[0].sampleRate, D = bufs.reduce((a, b) => a + b.duration, 0) / bufs.length;
    const parts = [];
    let t = 0, last = -1;
    const slice = (b, from, n) => b.getChannelData(0).slice(Math.max(0, from), Math.max(0, from) + n);
    while (t < D) {
      let k = Math.floor(Math.random() * bufs.length);
      if (k === last) k = (k + 1) % bufs.length;
      last = k;
      const len = (0.22 + 0.35 * Math.random()) * (1.3 - 0.5 * amount);   // shorter slices when more unsettled
      const b = bufs[k], from = Math.round((t / D) * b.length), n = Math.round(len * sr * (b.duration / D));
      let x = slice(b, from, n);
      if (Math.random() < 0.1 * amount) {   // a crunch: sample-and-hold
        const step = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < x.length; i++) x[i] = x[i - (i % step)];
      }
      const fade = Math.min(x.length >> 1, Math.round(0.015 * sr));
      for (let i = 0; i < fade; i++) { x[i] *= i / fade; x[x.length - 1 - i] *= i / fade; }
      parts.push(x);
      if (Math.random() < 0.08 * amount && x.length > 0.1 * sr) {   // a stutter: a grain, again
        const g = x.slice(0, Math.round((0.06 + 0.03 * Math.random()) * sr));
        for (let r = 0; r < 1 + Math.floor(Math.random() * 2); r++) parts.push(g);
      }
      if (Math.random() < 0.04 * amount) parts.push(new Float32Array(Math.round((0.03 + 0.03 * Math.random()) * sr)));   // a dropout
      t += len;
    }
    const total = parts.reduce((a, p) => a + p.length, 0), out = this.ctx.createBuffer(1, total, sr), y = out.getChannelData(0);
    let at = 0;
    for (const p of parts) { y.set(p, at); at += p.length; }
    return this.play(out, text, { onStart, onReveal });
  }

  /** Finding its voice: "is this me?" in the voice under your finger (a snippet, or the whole). */
  async probe(voice, full = false) {
    const token = (this.probeToken = (this.probeToken || 0) + 1);
    const buf = await this.fetchBuffer(PROBE, voice).catch(() => null);
    if (!buf || token !== this.probeToken) return null;
    this.stopProbe();
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), now = this.ctx.currentTime;
    src.buffer = buf; src.connect(g); g.connect(this.ctx.destination);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1, now + 0.015);
    src.start(now);
    if (!full) { g.gain.setValueAtTime(1, now + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38); src.stop(now + 0.4); }
    this.probing = { src, g };
    return this.envelopeOf(buf).slice(0, full ? undefined : 20);
  }
  stopProbe() {
    if (!this.probing) return;
    const { src, g } = this.probing, now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    try { src.stop(now + 0.04); } catch { /* already stopped */ }
    this.probing = null;
  }

  /** Say a line in the app's own voice (a speaker id, or a blend), with lip-sync and reveal. */
  async speakModel(text, voice, { speed = 1, robot = false, onStart, onReveal } = {}) {
    const buf = await this.fetchBuffer(text, voice, { speed, robot });
    return this.play(buf, text, { onStart, onReveal });
  }

  // ---- the fallback voice: the system's own offline speech -----------------------------------
  canSpeak() { return !!window.speechSynthesis && this.voices.length > 0; }

  /** Speak with a system voice (offline ones only); resolves when done. */
  speak(text, who = 'orb', feel = 'calm', { onStart, onReveal } = {}) {
    const PICK = {
      orb: [['Samantha', 'Tessa', 'Moira', 'Karen', 'Serena'], 1.25, 1.0],
      girl: [['Karen', 'Moira', 'Tessa', 'Victoria', 'Samantha'], 1.08, 1.0],
      boy: [['Daniel', 'Alex', 'Tom', 'Aaron', 'Fred'], 0.9, 0.95],
      machine: [['Zarvox', 'Trinoids', 'Fred', 'Ralph', 'Daniel'], 0.7, 0.88],
    };
    const [names, pitch, rate] = PICK[who] || PICK.orb, [pm, , tm] = FEEL[feel] || FEEL.calm;
    const voice = names.map(n => this.voices.find(v => v.name.startsWith(n))).find(Boolean) || this.voices[0];
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.lang = voice.lang;
    u.pitch = Math.min(2, pitch * (0.85 + 0.15 * pm)); u.rate = rate * (0.9 + 0.1 * tm);
    // Lip-sync: its syllables spread over an estimate of the spoken time.
    const syl = syllables(text), per = 0.2 / u.rate, env = [];
    let est = 0;
    for (const s of syl) {
      const a = Math.round(est / 0.02), n = Math.round(per / 0.02);
      while (env.length < a) env.push(0);
      for (let k = 0; k < n; k++) env[a + k] = 0.7 * Math.sin(Math.PI * (k + 0.5) / n);
      est += per + s.pause;
    }
    return new Promise(res => {
      let done = false, timer = null, t0 = 0, heard = 0;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); clearInterval(tick); res(); } };
      const tick = setInterval(() => {   // reveal on time if the voice sends no word boundaries
        if (!t0) return;
        const k = (performance.now() - t0) / 1000 / est;
        onReveal?.(Math.max(heard, Math.floor(text.length * Math.min(1, k))));
      }, 60);
      u.onstart = () => { t0 = performance.now(); onStart?.(env); timer = setTimeout(finish, est * 1800 + 2500); };
      u.onboundary = e => { if (e.name === 'word' || e.name === undefined) heard = Math.max(heard, e.charIndex + (e.charLength || 1)); };
      u.onend = u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }

  // ---- the ears ----------------------------------------------------------------------------
  async listen() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      this.unlock();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      return true;
    } catch { return false; }
  }

  /** Your voice's loudness now, 0..1 (about -55 dB to -15 dB). */
  hearing() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let e = 0;
    for (const x of this.buf) e += x * x;
    const db = 10 * Math.log10(e / this.buf.length + 1e-12);
    return Math.max(0, Math.min(1, (db + 55) / 40));
  }
}
