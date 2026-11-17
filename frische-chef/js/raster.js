// Laufraster der O&G-Abteilung und Wegsuche (A* mit 8 Richtungen, danach Wege glätten).
export const CELL = 0.5;          // Meter je Rasterfeld
const R_FIG = 0.32;               // Abstand, den Figuren zu Möbeln halten

// Gedrehtes Rechteck [cx, cy, w, h, winkelGrad] -> lokale Koordinaten
export function local(b, x, y) {
  const a = b[4] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - b[0], dy = y - b[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}
export function inBox(b, x, y, grow = 0) {
  const [lx, ly] = local(b, x, y);
  return Math.abs(lx) <= b[2] / 2 + grow && Math.abs(ly) <= b[3] / 2 + grow;
}
export function boxDist(b, x, y) {
  const [lx, ly] = local(b, x, y);
  const dx = Math.max(0, Math.abs(lx) - b[2] / 2), dy = Math.max(0, Math.abs(ly) - b[3] / 2);
  return Math.hypot(dx, dy);
}
export function corners(b) {
  const a = b[4] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = sx * b[2] / 2, ly = sy * b[3] / 2;
    return [b[0] + lx * c - ly * s, b[1] + lx * s + ly * c];
  });
}
function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
}
function inPoly(poly, x, y) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// Kleiner Binärheap für A*
class Heap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

export class Raster {
  constructor(og) {
    this.W = og.breite; this.H = og.hoehe;
    this.cols = Math.ceil(this.W / CELL); this.rows = Math.ceil(this.H / CELL);
    const n = this.cols * this.rows;
    this.wall = new Uint8Array(n);       // fest: Möbel, Wände, außen
    this.dyn = new Uint8Array(n);        // beweglich: Leergut auf dem Boden
    const [lx0, ly0, lx1, ly1] = og.lager;
    const bodies = [...og.stationen.map(s => s.body), ...og.deko.map(d => d.body)];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const x = (c + .5) * CELL, y = (r + .5) * CELL;
      let b = false;
      if (y < ly1 && !(x >= lx0 && x <= lx1 && y >= ly0)) b = true;              // über der Rückwand nur Lager
      if (!b) b = bodies.some(bd => inBox(bd, x, y, R_FIG));
      if (!b) b = og.waende.some(([p, q]) => segDist(x, y, p, q) < R_FIG + 0.12);
      if (!b) b = og.aussen.some(p => inPoly(p, x, y));
      this.wall[r * this.cols + c] = b ? 1 : 0;
    }
  }
  idx(x, y) {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }
  center(i) { return [(i % this.cols + .5) * CELL, (Math.floor(i / this.cols) + .5) * CELL]; }
  free(i, extra) { return i >= 0 && !this.wall[i] && !this.dyn[i] && !(extra && extra.has(i)); }
  // nächstes freies Feld zu einem Punkt
  nearestFree(x, y, extra, maxR = 6) {
    const i0 = this.idx(Math.min(Math.max(x, 0.01), this.W - 0.01), Math.min(Math.max(y, 0.01), this.H - 0.01));
    if (this.free(i0, extra)) return i0;
    let best = -1, bd = 1e9;
    const c0 = i0 % this.cols, r0 = Math.floor(i0 / this.cols), R = Math.ceil(maxR / CELL);
    for (let r = r0 - R; r <= r0 + R; r++) for (let c = c0 - R; c <= c0 + R; c++) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      const i = r * this.cols + c;
      if (!this.free(i, extra)) continue;
      const [cx, cy] = this.center(i), d = Math.hypot(cx - x, cy - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // Felder, von denen aus man an einer Station arbeitet (in ihren Arbeitszonen)
  zoneCells(st) {
    const out = [];
    for (let i = 0; i < this.wall.length; i++) {
      if (this.wall[i]) continue;
      const [x, y] = this.center(i);
      if (st.zones.some(z => inBox(z, x, y, 0.05))) out.push(i);
    }
    if (!out.length) {
      for (let i = 0; i < this.wall.length; i++) {
        if (this.wall[i]) continue;
        const [x, y] = this.center(i);
        if (boxDist(st.body, x, y) < 1.2) out.push(i);
      }
    }
    return out;
  }
  // A* von Punkt zu einer Menge von Zielfeldern. extra: zusätzlich gesperrte Felder (z. B. stehende Kunden)
  path(x, y, goals, extra) {
    const start = this.idx(x, y);
    const goalSet = new Set(goals.filter(g => this.free(g, extra)));
    if (start < 0 || !goalSet.size) return null;
    if (goalSet.has(start)) return [[x, y]];
    const gpts = [...goalSet].map(g => this.center(g));
    const h = i => { const [cx, cy] = this.center(i); let m = 1e9; for (const [gx, gy] of gpts) m = Math.min(m, Math.hypot(gx - cx, gy - cy)); return m; };
    const n = this.wall.length, g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
    const heap = new Heap(); g[start] = 0; heap.push(h(start), start);
    const C = this.cols, D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = -1, steps = 0;
    while (heap.size && steps++ < 20000) {
      const cur = heap.pop();
      if (goalSet.has(cur)) { found = cur; break; }
      const c = cur % C, r = (cur / C) | 0;
      for (const [dc, dr, cost] of D) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= C || nr >= this.rows) continue;
        const ni = nr * C + nc;
        if (!this.free(ni, extra) && ni !== start) continue;
        if (dc && dr && (!this.free(r * C + nc, extra) || !this.free(nr * C + c, extra))) continue;   // keine Ecken schneiden
        const ng = g[cur] + cost;
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ng + h(ni) / CELL, ni); }
      }
    }
    if (found < 0) return null;
    const cells = [];
    for (let i = found; i !== start && i >= 0; i = from[i]) cells.push(i);
    cells.reverse();
    return this.smooth([[x, y], ...cells.map(i => this.center(i))], extra);
  }
  // Sichtlinie: alle Felder auf der Strecke frei?
  clear(a, b, extra) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / (CELL * 0.35));
    for (let k = 1; k <= n; k++) {
      const t = k / n, i = this.idx(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!this.free(i, extra)) return false;
    }
    return true;
  }
  smooth(pts, extra) {
    if (pts.length < 3) return pts.slice(1);
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i], pts[j], extra)) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
}
