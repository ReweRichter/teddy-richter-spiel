// Baut aus den exportierten Bauanweisungen (Quader, Kugeln, Flächen) eine Three.js-Geometrie.
// Gleiches Verfahren wie game/meshkit.py: Licht ist in die Vertexfarben eingebacken.
// Koordinaten: Spiel (x, y, z) mit z nach "oben" auf dem Bildschirm -> Three.js (x, y, -z).
import * as THREE from 'three';

const SHADE = { up: 1.0, down: 0.5, s: 0.86, n: 0.7, e: 0.78, w: 0.74 };
const FACES = [
  ['up', [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
  ['s', [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ['n', [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
  ['e', [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
  ['w', [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
  // Unterseite sieht die Kamera nie -> weggelassen (spart Rechenzeit am Handy)
];
const LX = 0.0, LY = 0.83, LZ = -0.55;

export class OpsBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; this.alpha = false; }
  get count() { return this.pos.length / 3; }

  box(o) {
    const [cx, cy, cz, sx, sy, sz, r, g, b, a, shade] = o;
    if (a < 1) this.alpha = true;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (const [key, corners] of FACES) {
      const f = shade ? SHADE[key] : 1;
      const i = this.count;
      for (const [px, py, pz] of corners) {
        this.pos.push(cx + px * hx, cy + py * hy, -(cz + pz * hz));
        this.col.push(r * f, g * f, b * f, a);
      }
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  ellipsoid(o) {
    const [cx, cy, cz, rx, ry, rz, r, g, b, seg, rings, flat] = o;
    const base = this.count;
    for (let i = 0; i <= rings; i++) {
      const th = Math.PI * i / rings, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= seg; j++) {
        const ph = 2 * Math.PI * j / seg;
        const nx = st * Math.sin(ph), ny = ct, nz = -st * Math.cos(ph);
        this.pos.push(cx + rx * nx, cy + ry * ny, -(cz + rz * nz));
        let f = 1;
        if (!flat) {
          const gx = nx / rx, gy = ny / ry, gz = nz / rz;
          const gl = Math.hypot(gx, gy, gz) || 1;
          const d = (gx * LX + gy * LY + gz * LZ) / gl;
          f = 0.62 + 0.45 * Math.max(0, d);
        }
        this.col.push(Math.min(1, r * f), Math.min(1, g * f), Math.min(1, b * f), 1);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const v0 = base + i * (seg + 1) + j, v1 = v0 + seg + 1;
        this.idx.push(v0, v0 + 1, v1 + 1, v0, v1 + 1, v1);
      }
    }
  }

  poly(o) {
    const [y, r, g, b, pts] = o;
    const i = this.count;
    for (const [x, z] of pts) { this.pos.push(x, y, -z); this.col.push(r, g, b, 1); }
    for (let k = 1; k < pts.length - 1; k++) this.idx.push(i, i + k, i + k + 1);
  }

  add(op) {
    const t = op[0], rest = op.slice(1);
    if (t === 'b') this.box(rest);
    else if (t === 'e') this.ellipsoid(rest);
    else if (t === 'p') this.poly(rest);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setIndex(this.count > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function vertexMaterial(transparent = false) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent });
}

export function meshFromOps(ops, material) {
  const b = new OpsBuilder();
  for (const op of ops) b.add(op);
  return new THREE.Mesh(b.geometry(), material || vertexMaterial(b.alpha));
}

// Große Bauteillisten in Kacheln aufteilen, damit nur Sichtbares gezeichnet wird.
export function chunkedMeshes(ops, material, size = 12) {
  const buckets = new Map();
  for (const op of ops) {
    let x, z;
    if (op[0] === 'p') { x = op[5][0][0]; z = op[5][0][1]; } else { x = op[1]; z = op[3]; }
    const key = Math.floor(x / size) + ',' + Math.floor(z / size);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(op);
  }
  return [...buckets.values()].map(list => meshFromOps(list, material));
}
