// Sehr einfache, leise Hintergrundmusik, im Browser erzeugt (keine Audiodateien).
// Ruhiger Grundtakt; je hektischer das Spiel (Druck 0..1, Verlängerung), desto schneller und dichter.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];           // Dur-Pentatonik
const BASS = [0, 0, 7, 7, 9, 9, 5, 7];                // Grundtöne je Takt (Halbtöne über C)

export class Musik {
  constructor() {
    this.ctx = null; this.on = true; this.step = 0; this.next = 0; this.timer = null;
    this.druck = 0; this.finale = false; this.out = null;
    try { this.on = localStorage.getItem('fc-musik') !== 'aus'; } catch { /* egal */ }
  }
  start(ctx) {
    if (!ctx || this.timer) return;
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.0;
    this.out.connect(ctx.destination);
    this.out.gain.linearRampToValueAtTime(this.on ? 0.55 : 0, ctx.currentTime + 1.2);
    this.next = ctx.currentTime + 0.1; this.step = 0;
    this.timer = setInterval(() => this.tick(), 30);
  }
  stop() {
    if (!this.timer) return;
    clearInterval(this.timer); this.timer = null;
    const o = this.out, t = this.ctx.currentTime;
    o.gain.cancelScheduledValues(t); o.gain.setValueAtTime(o.gain.value, t); o.gain.linearRampToValueAtTime(0, t + 0.4);
    setTimeout(() => o.disconnect(), 600);
  }
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('fc-musik', this.on ? 'an' : 'aus'); } catch { /* egal */ }
    if (this.out) this.out.gain.setTargetAtTime(this.on ? 0.55 : 0, this.ctx.currentTime, 0.1);
    return this.on;
  }
  get bpm() { return this.finale ? 138 : 100 + 22 * this.druck; }
  note(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }
  hat(t, vol) {
    const n = this.ctx.sampleRate * 0.04, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = vol;
    s.buffer = b; s.connect(f).connect(g).connect(this.out); s.start(t);
  }
  tick() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.15) {
      const t = this.next, s = this.step, bar = Math.floor(s / 8) % BASS.length, root = 130.81 * 2 ** (BASS[bar] / 12);
      const hektisch = this.finale || this.druck > 0.55;
      if (s % 4 === 0) this.note(root / 2, t, 0.35, 'triangle', 0.22);              // Bass auf 1 und 3
      if (s % 4 === 2 && hektisch) this.note(root / 2, t, 0.18, 'triangle', 0.12);
      // Melodie: wenige Töne, zufällig aus der Pentatonik, nie dieselbe Folge
      const dicht = this.finale ? 0.75 : 0.35 + 0.3 * this.druck;
      if (s % 2 === 0 && Math.random() < dicht) {
        const iv = SCALE[(Math.floor(Math.random() * 5) + (s % 8 === 0 ? 0 : 2)) % SCALE.length];
        this.note(261.63 * 2 ** ((BASS[bar] + iv) / 12), t, 0.22, 'sine', 0.07);
      }
      if (hektisch && s % 2 === 1) this.hat(t, this.finale ? 0.05 : 0.03);
      this.next += 60 / this.bpm / 2;          // Achtel
      this.step++;
    }
  }
}
