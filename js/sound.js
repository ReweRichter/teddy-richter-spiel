// Soundeffekte werden im Browser erzeugt (wie game/sound.py), keine Audiodateien, keine Musik.
const RATE = 22050;

function env(i, n, decay) {
  const t = i / RATE;
  return Math.min(1, t / 0.005) * Math.exp(-decay * t / (n / RATE));
}
function tone(freqs, dur, vol = 0.6, decay = 4, square = false, sweep = null) {
  const n = Math.floor(dur * RATE), out = new Float32Array(n), ph = freqs.map(() => 0);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    let s = 0;
    freqs.forEach((f0, j) => {
      const f = sweep ? f0 + (sweep[j] - f0) * k : f0;
      ph[j] += 2 * Math.PI * f / RATE;
      const v = Math.sin(ph[j]);
      s += square ? (v > 0 ? 0.5 : -0.5) : v;
    });
    out[i] = s / freqs.length * vol * env(i, n, decay);
  }
  return out;
}
function noise(dur, vol = 0.4, decay = 8, smooth = 0) {
  const n = Math.floor(dur * RATE), out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = last * smooth + (Math.random() * 2 - 1) * (1 - smooth);
    out[i] = last * vol * env(i, n, decay);
  }
  return out;
}
function mix(...parts) {
  const n = Math.max(...parts.map(p => p.length)), out = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const silence = d => new Float32Array(Math.floor(d * RATE));

function makeAll() {
  return {
    beep: tone([1900], 0.12, 0.5, 1.5),
    throw: mix(tone([320], 0.22, 0.35, 2, false, [950]), noise(0.22, 0.15, 3, 0.6)),
    land: mix(tone([160], 0.14, 0.6, 5, false, [70]), noise(0.1, 0.25, 9, 0.3)),
    bump: mix(tone([95], 0.25, 0.8, 5, false, [55]), noise(0.15, 0.35, 8, 0.5), tone([620, 930], 0.12, 0.2, 7)),
    count: tone([660], 0.2, 0.5, 3),
    go: tone([990, 1485], 0.45, 0.5, 2.5),
    gong: concat(tone([784, 1568], 0.55, 0.5, 3), tone([622, 1244], 0.8, 0.5, 3)),
    squeak: tone([1500, 1530], 0.22, 0.18, 1.5, false, [2300, 2250]),
    ok: tone([880, 1320], 0.18, 0.4, 4),
    wrong: tone([170], 0.3, 0.35, 3, true),
    kaching: concat(noise(0.05, 0.3, 6, 0.2), tone([2093, 3136], 0.6, 0.45, 4)),
    click: tone([1200], 0.05, 0.35, 6),
    ambient: concat(tone([1900], 0.1, 0.12, 1.5), silence(0.12), tone([1900], 0.1, 0.12, 1.5)),
  };
}

export class Sounds {
  constructor() {
    this.muted = false;
    this.ctx = null;
    this.buffers = {};
    try { this.muted = localStorage.getItem('teddy-ton') === 'aus'; } catch { /* privates Fenster */ }
  }

  unlock() {
    // Browser erlauben Ton erst nach der ersten Berührung
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    for (const [name, data] of Object.entries(makeAll())) {
      const b = this.ctx.createBuffer(1, data.length, RATE);
      b.copyToChannel(data, 0);
      this.buffers[name] = b;
    }
  }

  play(name, vol = 1) {
    if (this.muted || !this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('teddy-ton', this.muted ? 'aus' : 'an'); } catch { /* egal */ }
    return this.muted;
  }
}
