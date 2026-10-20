// Sons 8-bit sintetizados na hora com WebAudio: nenhum arquivo de áudio no repositório.

let ctx = null, master = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem("ocrb-muted") === "1"; } catch { return false; } })();

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16; // volume geral baixo: é enfeite, não alarme
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur, o = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (o.delay || 0);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || "square";
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const v = o.vol ?? 0.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.03);
}

function noise(dur, o = {}) {
  const c = ac(); if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) { if (i % 8 === 0) v = Math.random() * 2 - 1; d[i] = v; } // sample & hold = ruído "crocante"
  }
  const t = c.currentTime + (o.delay || 0);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  f.type = o.ftype || "bandpass"; f.frequency.value = o.freq || 1200;
  g.gain.setValueAtTime(o.vol ?? 0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

const seq = (notes, step, o = {}) => notes.forEach((f, i) => f && tone(f, o.len || step * 0.9, { ...o, delay: (o.delay || 0) + i * step }));

const FX = {
  chomp() { [0, 0.13, 0.26].forEach((d) => { noise(0.07, { delay: d, freq: 500, vol: 0.6 }); tone(170, 0.07, { delay: d, to: 80, vol: 0.3 }); }); },
  gulp() { tone(320, 0.18, { to: 90, type: "triangle", vol: 0.6 }); },
  hungry() { tone(220, 0.12, { to: 330, vol: 0.25 }); },
  blip() { tone(600 + Math.random() * 900, 0.03, { vol: 0.1 }); },
  success() { seq([523, 659, 784, 1047], 0.07, { len: 0.1, vol: 0.35 }); },
  table() { seq([392, 523, 659, 784, 1047, 1319], 0.06, { len: 0.09, vol: 0.35 }); },
  empty() { seq([392, 330], 0.13, { len: 0.15, vol: 0.3, type: "triangle" }); },
  error() { tone(196, 0.42, { type: "sawtooth", to: 98, vol: 0.3 }); },
  pick() { tone(660, 0.06, { vol: 0.3 }); },
  toss() { tone(300, 0.25, { to: 1200, vol: 0.3 }); },
  catch() { seq([988, 1319], 0.07, { len: 0.12, vol: 0.35 }); },
  step() { noise(0.03, { freq: 300, vol: 0.25 }); },
  whoosh() { noise(0.4, { freq: 2500, vol: 0.35 }); tone(200, 0.35, { to: 900, type: "triangle", vol: 0.15 }); },
  boing() { tone(140, 0.32, { to: 520, type: "sine", vol: 0.6 }); tone(520, 0.2, { to: 300, type: "sine", vol: 0.3, delay: 0.3 }); },
  beep() { seq([880, 660, 990, 0, 1320], 0.08, { len: 0.07, vol: 0.3 }); },
  glitch() {
    for (let i = 0; i < 7; i++) tone(200 + Math.random() * 1800, 0.03, { delay: i * 0.035, vol: 0.22, type: i % 2 ? "square" : "sawtooth" });
    noise(0.25, { freq: 3000, vol: 0.2 });
  },
  angry() { tone(110, 0.5, { type: "sawtooth", vol: 0.35 }); tone(117, 0.5, { type: "sawtooth", vol: 0.3 }); },
  snore() { tone(95, 0.7, { type: "triangle", to: 70, vol: 0.25 }); },
  wake() { seq([330, 660, 1320], 0.05, { len: 0.06, vol: 0.3 }); },
  party() {
    seq([523, 659, 784, 659, 880, 784, 659, 523, 587, 740, 880, 740, 988, 880, 740, 587], 0.11, { len: 0.1, vol: 0.2 });
    seq([131, 0, 196, 0, 175, 0, 196, 0, 147, 0, 220, 0, 196, 0, 220, 0], 0.11, { len: 0.09, vol: 0.25, type: "triangle" });
  },
  matrix() { seq([220, 0, 262, 0, 220, 0, 330, 294], 0.1, { len: 0.12, vol: 0.25, type: "triangle" }); },
};

export const sound = {
  play(name) { if (muted) return; try { FX[name]?.(); } catch { /* áudio é opcional */ } },
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem("ocrb-muted", muted ? "1" : "0"); } catch { /* modo privado */ }
    if (!muted) FX.pick();
    return muted;
  },
};
