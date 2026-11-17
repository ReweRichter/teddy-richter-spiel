// 3D-Darstellung der O&G-Abteilung für Frische-Chef (Three.js, schräge Draufsicht).
// Möbel, Ware und Schilder kommen aus dem 3D-Markt von Spiel 1 (einkauf/data/szene.json, aus dem Ladenplan exportiert).
// Lager, Figuren-Animation, Böden, Wände und Deko werden hier gebaut.
// Koordinaten: x = og.json-x (Meter nach rechts), z = og.json-y (Meter nach unten auf dem Bildschirm), y = Höhe.
import * as THREE from 'three';
import { OpsBuilder, meshFromOps, vertexMaterial } from '../../shared/js/meshops.js';

const OFF_X = 52.5, OFF_Z = 64.35;        // Spiel-1-Meter -> Ausschnittmeter (siehe tools/export_og.py)
const D2R = Math.PI / 180;
const ELEV = 56 * D2R;                    // Kamerawinkel über dem Boden

// Farben der Ware in den Kisten (wie die Warenfarben im Markt)
const WARE_FARBE = {
  bananen: [[0.98, 0.84, 0.16], [0.94, 0.78, 0.12]], tomaten: [[0.86, 0.12, 0.12], [0.94, 0.27, 0.16]],
  kartoffeln: [[0.78, 0.63, 0.39], [0.67, 0.51, 0.31]], aepfel: [[0.47, 0.75, 0.24], [0.86, 0.2, 0.16]],
  obst: [[0.98, 0.62, 0.12], [0.98, 0.82, 0.16]], gemuese: [[0.94, 0.47, 0.08], [0.24, 0.59, 0.2]],
  bioobst: [[0.35, 0.63, 0.24], [0.94, 0.59, 0.16]], salate: [[0.55, 0.8, 0.3], [0.43, 0.71, 0.24]],
  beeren: [[0.78, 0.08, 0.16], [0.24, 0.16, 0.47]], freshcut: [[0.94, 0.31, 0.35], [0.47, 0.78, 0.31]],
  smoothies: [[0.98, 0.63, 0.12], [0.47, 0.75, 0.24]],
};

// Hilfen zum Bauen eigener Modelle mit eingebackenem Licht (gleiches Verfahren wie Spiel 1)
class Bau {
  constructor() { this.b = new OpsBuilder(); }
  box(x, y, z, sx, sy, sz, c, a = 1, shade = 1) { this.b.box([x, y, -z, sx, sy, sz, c[0], c[1], c[2], a, shade]); return this; }
  ei(x, y, z, rx, ry, rz, c, seg = 10, rings = 7) { this.b.ellipsoid([x, y, -z, rx, ry, rz, c[0], c[1], c[2], seg, rings, 0]); return this; }
  mesh(transparent = false) { return new THREE.Mesh(this.b.geometry(), vertexMaterial(transparent || this.b.alpha)); }
}
const hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

function canvasTex(w, h, paint, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function blobTex() {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
}

export class Welt {
  constructor(canvas, og, szene) {
    this.og = og;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2f3a33);
    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 300);
    this.blob = blobTex();
    this.t = 0;
    this.baueBoden();
    this.baueMarkt(szene);
    this.baueWaende();
    this.baueLager();
    this.baueDraussen();
    this.baueMarkierungen();
    this.figuren = {};
    this.kunden = new Map();
    this.leergut = new Map();
    this.kistenKey = '';
    this.paletteGrp = new THREE.Group(); this.scene.add(this.paletteGrp);
    this.teddyOps = szene.actors.teddy;
    this.kundenOps = szene.actors.customers;
  }

  // ---------- Aufbau ----------
  baueBoden() {
    const { breite: W, hoehe: H, lager } = this.og;
    // warmer Fliesenboden im Verkaufsraum
    const fl = canvasTex(256, 256, (g) => {
      g.fillStyle = '#efe3c8'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#f3e9d2' : '#eadcbd'; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
      g.strokeStyle = 'rgba(150,120,80,.35)'; g.lineWidth = 3;
      for (let k = 0; k <= 256; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); }
    }, [W / 2.4, H / 2.4]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: fl }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2);
    this.scene.add(floor);
    // Lagerboden: grauer Beton mit gelber Fahrspur
    const [x0, z0, x1, z1] = lager;
    const lt = canvasTex(256, 256, (g) => {
      g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
    }, [(x1 - x0) / 3, (z1 - z0) / 3]);
    const lf = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ map: lt }));
    lf.rotation.x = -Math.PI / 2; lf.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    this.scene.add(lf);
    const gelb = new THREE.MeshBasicMaterial({ color: 0xf5b400 });
    for (const [x, z, w, d] of [[x0 + 0.4, z1 - 1.0, x1 - x0 - 0.8, 0.08]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), gelb); s.rotation.x = -Math.PI / 2; s.position.set(x + w / 2, 0.008, z); this.scene.add(s);
    }
    // Tür-Schwelle gelb-schwarz
    const [tx0, tz, tx1] = this.og.tuer;
    const st = canvasTex(128, 16, (g) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#222' : '#f5b400'; g.beginPath(); g.moveTo(i * 16 - 8, 16); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 16, 0); g.lineTo(i * 16, 16); g.fill(); } });
    const th = new THREE.Mesh(new THREE.PlaneGeometry(tx1 - tx0, 0.45), new THREE.MeshBasicMaterial({ map: st }));
    th.rotation.x = -Math.PI / 2; th.position.set((tx0 + tx1) / 2, 0.012, tz); this.scene.add(th);
  }

  baueMarkt(szene) {
    const W = this.og.breite, H = this.og.hoehe;
    const root = new THREE.Group();
    root.position.set(-OFF_X, 0, OFF_Z);
    this.scene.add(root);
    const inside = (gx, gz, m = 0.2) => gx - OFF_X > -m && gx - OFF_X < W + m && OFF_Z - gz > -m && OFF_Z - gz < H + m;
    const nearWall = (gx, gz) => this.og.waende.some(([a, b]) => segDist(gx - OFF_X, OFF_Z - gz, a, b) < 0.55);
    const loader = new THREE.TextureLoader();
    for (const it of szene.items) {
      const p = it.pos || [0, 0, 0];
      if (it.type === 'mesh') {
        if (p[0] === 0 && p[2] === 0 && !it.ry) {
          // großes Sammel-Mesh: nur Bauteile im Ausschnitt, keine Wände (die baut baueWaende neu, mit Lagertür)
          const ops = it.ops.filter(op => {
            if (op[0] === 'p') return false;
            const gx = op[1], gz = op[3];
            if (!inside(gx, gz)) return false;
            if (op[0] === 'b' && (op[5] > 2.2 || nearWall(gx, gz))) return false;
            return true;
          });
          if (ops.length) root.add(meshFromOps(ops));
        } else if (inside(p[0], p[2], 1)) {
          const m = meshFromOps(it.ops); place(m, it); root.add(m);
        }
      } else if ((it.type === 'quad' || it.type === 'cube') && inside(p[0], p[2], 0)) {
        let obj;
        if (it.type === 'quad') {
          const [sx, sy] = Array.isArray(it.scale) ? it.scale : [it.scale, it.scale];
          const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
          if (it.tex) { const t = loader.load(`../einkauf/img/tex/${it.tex}.png`); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; mat.map = t; mat.alphaTest = 0.02; }
          if (it.color) { mat.color = new THREE.Color(it.color[0], it.color[1], it.color[2]); mat.opacity = it.color[3]; }
          obj = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat);
          obj.position.set(p[0], p[1], -p[2]);
          obj.rotation.x = -(it.rx || 0) * D2R;
        } else {
          const s = it.scale, c = it.color || [1, 1, 1];
          obj = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) }));
          obj.position.set(p[0], p[1], -p[2]);
        }
        root.add(obj);
      }
    }
  }

  baueWaende() {
    const H = 1.25, T = 0.38;
    const koerper = hex(0xd8cfc0), kante = hex(0xcc071e), sockel = hex(0x8a8580);
    for (const [a, b] of this.og.waende) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) + T;
      const m = new Bau()
        .box(0, H / 2, 0, L, H, T, koerper)
        .box(0, 0.12, 0, L + 0.02, 0.24, T + 0.04, sockel)
        .box(0, H + 0.06, 0, L + 0.04, 0.12, T + 0.08, kante).mesh();
      m.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
      m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      this.scene.add(m);
    }
    // Rand nach links und unten: niedrige Bodenkante, damit das Feld eingefasst wirkt
    const { breite: W, hoehe: Hh } = this.og;
    const kant = new Bau().box(W / 2, 0.05, Hh + 0.15, W, 0.1, 0.3, hex(0x9a948a)).box(-0.15, 0.05, Hh / 2, 0.3, 0.1, Hh, hex(0x9a948a)).mesh();
    this.scene.add(kant);
  }

  baueLager() {
    const st = id => this.og.stationen.find(s => s.id === id);
    const holz = hex(0xc79a5b), holzD = hex(0x8a6532), stahl = hex(0xc9ced4), stahlD = hex(0x7d848c);
    // Lieferpalette
    const p = st('palette').body;
    const pal = new Bau();
    for (const dz of [-1.2, 0, 1.2]) pal.box(p[0], 0.06, p[1] + dz, p[2], 0.12, 0.3, holzD);
    for (const dx of [-1.25, -0.62, 0, 0.62, 1.25]) pal.box(p[0] + dx, 0.16, p[1], 0.42, 0.06, p[3], holz);
    this.scene.add(pal.mesh());
    this.paletteBody = p;
    // Sortiertisch: Edelstahl mit Beinen, Rollen Etiketten und Folie
    const s = st('sortier').body;
    const t = new Bau();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(s[0] + sx * (s[2] / 2 - 0.12), 0.45, s[1] + sz * (s[3] / 2 - 0.12), 0.08, 0.9, 0.08, stahlD);
    t.box(s[0], 0.93, s[1], s[2], 0.07, s[3], stahl).box(s[0], 0.3, s[1], s[2] - 0.2, 0.04, s[3] - 0.2, stahlD);
    t.box(s[0] - s[2] / 2 + 0.5, 1.05, s[1] - 0.3, 0.5, 0.18, 0.3, hex(0xffe14d));          // Preisschilder
    t.ei(s[0] + s[2] / 2 - 0.5, 1.07, s[1] - 0.3, 0.16, 0.12, 0.16, hex(0xdfeefa));         // Folienrolle
    this.scene.add(t.mesh());
    this.baueKuehlhaus();
    // Ballenpresse: großer grauer Kasten mit Klappe und rotem Streifen
    const b = st('presse').body;
    this.scene.add(new Bau().box(b[0], 1.2, b[1], b[2] - 0.3, 2.4, b[3] - 0.3, hex(0x6b6f75)).box(b[0], 1.0, b[1] + b[3] / 2 - 0.13, b[2] - 0.8, 0.9, 0.06, hex(0x2c2e31))
      .box(b[0], 2.2, b[1] + b[3] / 2 - 0.13, b[2] - 0.3, 0.14, 0.06, hex(0xcc071e)).box(b[0] + 0.9, 1.75, b[1] + b[3] / 2 - 0.12, 0.25, 0.25, 0.05, hex(0x3fbf3f), 1, 0).mesh());
    // Waage für Kunden
    const w = st('waage').body;
    this.scene.add(new Bau().box(w[0], 0.45, w[1], 0.35, 0.9, 0.35, hex(0xdadde0)).box(w[0], 0.95, w[1], w[2] - 0.2, 0.1, w[3] - 0.1, hex(0xf2f3f4))
      .box(w[0], 1.25, w[1] - 0.2, 0.6, 0.45, 0.08, hex(0x2c2e31)).box(w[0], 1.27, w[1] - 0.15, 0.45, 0.25, 0.02, hex(0x9fe0a0), 1, 0).mesh());
    // Deko im Lager: Regal mit gestapelten IFCO-Kisten an der Rückwand, Rollcontainer
    const [x0, z0, x1] = this.og.lager;
    const reg = new Bau();
    const rx = (p[0] + s[0]) / 2 + 0.2;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) reg.box(x1 - 0.9 - k * 0.0, 0.18 + i * 0.36, z0 + 0.6 + k * 0.85, 0.75, 0.32, 0.65, hex(0x7d9bb0));
    reg.box(rx, 0.02, z0 + 0.4, 0.01, 0.01, 0.01, holz);
    this.scene.add(reg.mesh());
  }

  baueKuehlhaus() {
    // Kühlhaus hinter der Tür in der schrägen Wand (laut Inhaber zwischen Sushi und Obst). Hier wird die Retoure abgestellt.
    const poly = this.og.kuehlhaus, [t0, t1] = this.og.kuehltuer;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xdfe8ee }));
    fl.rotation.x = -Math.PI / 2; fl.position.y = 0.02; this.scene.add(fl);
    // Wände: die drei Seiten außer der Türwand
    const wand = hex(0xeef3f6), kante = hex(0x2f7fd1);
    const seg = (a, b) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.3;
      const m = new Bau().box(0, 0.65, 0, L, 1.3, 0.3, wand).box(0, 1.36, 0, L + 0.02, 0.12, 0.36, kante).mesh();
      m.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      this.scene.add(m);
    };
    seg(poly[1], poly[2]); seg(poly[2], poly[3]); seg(poly[3], poly[0]);
    // Streifenvorhang in der Tür
    const ang = Math.atan2(t1[1] - t0[1], t1[0] - t0[0]);
    for (let i = 0; i < 6; i++) {
      const k = (i + 0.5) / 6, x = t0[0] + (t1[0] - t0[0]) * k, z = t0[1] + (t1[1] - t0[1]) * k;
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.15, 0.02), new THREE.MeshBasicMaterial({ color: 0xcfe6f5, transparent: true, opacity: 0.45, depthWrite: false }));
      st.position.set(x, 0.62, z); st.rotation.y = -ang; this.scene.add(st);
    }
    // Schild über der Tür
    const sc = canvasTex(256, 64, (g) => { g.fillStyle = '#2f7fd1'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#fff'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('❄ KÜHLHAUS', 128, 34); });
    const schild = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), new THREE.MeshBasicMaterial({ map: sc }));
    schild.position.set((t0[0] + t1[0]) / 2, 1.75, (t0[1] + t1[1]) / 2); schild.rotation.order = 'YXZ'; schild.rotation.y = -ang + Math.PI; schild.rotation.x = -0.6;
    this.scene.add(schild);
    // Retoure-Gitterbox (Rollcontainer) mit Schild
    const r = this.og.stationen.find(x => x.id === 'retoure').body;
    const gb = new Bau(), grau = hex(0x9aa1a8), dunkel = hex(0x5d646b);
    gb.box(0, 0.08, 0, r[2], 0.12, r[3], dunkel);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box(sx * (r[2] / 2 - 0.04), 0.75, sz * (r[3] / 2 - 0.04), 0.06, 1.35, 0.06, grau);
    for (const y of [0.5, 0.9, 1.3]) { gb.box(0, y, -r[3] / 2 + 0.04, r[2], 0.04, 0.04, grau); gb.box(-r[2] / 2 + 0.04, y, 0, 0.04, 0.04, r[3], grau); gb.box(r[2] / 2 - 0.04, y, 0, 0.04, 0.04, r[3], grau); }
    gb.box(0, 1.15, r[3] / 2, 1.1, 0.32, 0.02, hex(0x8b6b4a), 1, 0);
    const cage = new THREE.Group(); cage.add(gb.mesh());
    cage.position.set(r[0], 0, r[1]); cage.rotation.y = -r[4] * D2R;
    this.retoureInhalt = new THREE.Group(); cage.add(this.retoureInhalt); this.retoureZahl = -1;
    this.scene.add(cage);
    this.schatten(r[0], r[1], r[2] + 0.8, r[3] + 0.8, 0.4);
    // Retoure-Kisten auf dem Sortiertisch
    const s = this.og.stationen.find(x => x.id === 'sortier').body;
    this.tischRetoure = new THREE.Group(); this.tischRetoure.position.set(s[0] - s[2] / 2 + 1.0, 0.97, s[1] + 0.1); this.scene.add(this.tischRetoure);
    this.tischZahl = -1;
  }
  retoureKiste() {
    // braune Kiste mit aussortierter, fleckiger Ware
    const b = new Bau();
    b.box(0, 0.14, 0, 0.56, 0.28, 0.4, hex(0x8b6b4a)).box(0, 0.27, 0, 0.5, 0.02, 0.34, hex(0x5e452d));
    for (let i = 0; i < 4; i++) b.ei(-0.14 + (i % 2) * 0.28, 0.32, i < 2 ? -0.07 : 0.07, 0.08, 0.06, 0.08, hex(i % 2 ? 0x6b5a2e : 0x7a4a1e), 7, 5);
    return b.mesh();
  }
  baueDraussen() {
    // Außenbereich hinter der schrägen Wand: Pflaster mit Bäumen in Pflanzkübeln
    const pf = canvasTex(128, 128, (g) => {
      g.fillStyle = '#5d5f58'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
      for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 * 16; x < 128; x += 32) g.strokeRect(x, y, 32, 32);
    }, [1, 1]);
    for (const poly of this.og.aussen) {
      const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ShapeGeometry(shape);
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
      pf.wrapS = pf.wrapT = THREE.RepeatWrapping;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: pf }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.01; this.scene.add(m);
    }
    // Lager rechts neben der Tür ist Außenbereich: dort Bäume
    for (const [x, z, s] of [[16.5, 2.6, 1.15], [23.5, 3.2, 1.3], [27.2, 9.5, 1.0], [21.2, 6.3, 0.85]]) this.baum(x, z, s);
    // Pflanze im Verkaufsraum neben dem Tor zum Lager
    this.topfpflanze(3.4, 7.6);
    this.baueUmgebung();
  }
  baueUmgebung() {
    // Rund um den Ausschnitt: Pflaster, Straße hinter dem Lager mit REWE-Lieferwagen, Rasen, übriger Markt links
    const W = this.og.breite, H = this.og.hoehe;
    const boden = (x, z, w, d, farbe, y = -0.02, map = null) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: farbe, map }));
      m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, y, z + d / 2); this.scene.add(m); return m;
    };
    boden(-60, -60, 160, 160, 0x7aa35a, -0.05);                                    // Rasen
    const pflaster = canvasTex(64, 64, (g) => { g.fillStyle = '#9b978c'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.strokeRect(1, 1, 31, 31); g.strokeRect(33, 33, 30, 30); g.strokeRect(33, 1, 30, 31); g.strokeRect(1, 33, 31, 30); }, [40, 4]);
    boden(-30, -4.2, 80, 4.2, 0xffffff, -0.03, pflaster);                           // Gehweg/Hof hinter dem Lager
    const strasse = canvasTex(256, 64, (g) => { g.fillStyle = '#44474b'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#e8e8e8'; for (let x = 0; x < 256; x += 64) g.fillRect(x + 8, 30, 36, 4); }, [12, 1]);
    boden(-30, -12, 80, 7.8, 0xffffff, -0.03, strasse);                             // Straße
    boden(-30, -4.4, 80, 0.25, 0xd0ccc2, 0.0);                                      // Bordstein
    // Markt geht links weiter: Boden und ein paar Regalreihen
    const fl = this.scene.children.find(c => c.material && c.material.map && c.geometry.parameters && c.geometry.parameters.width === W);
    if (fl) boden(-14, 6.6, 14, H - 6.6 + 4, 0xffffff, -0.001, fl.material.map.clone());
    boden(0, H, W, 4, 0xe8dcc0, -0.001);
    boden(-14, 0, 14, 6.6, 0xb4b1a9, -0.001);                                      // Lager geht links weiter
    this.scene.add(new Bau().box(-7, 0.62, 6.6, 14, 1.25, 0.38, hex(0xd8cfc0)).box(-7, 1.31, 6.6, 14.04, 0.12, 0.46, hex(0xcc071e)).mesh());
    for (const x of [-2.6, -6.4, -10.2]) {
      const r = new Bau().box(x, 0.8, 21, 1.2, 1.6, 20, hex(0xd9d5cc));
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) r.box(x + sx * 0.62, 0.3 + i * 0.38, 21, 0.02, 0.22, 19.6, hex([0xcc4a3a, 0x3a7fcc, 0xe0b030, 0x5aa040][(i + (sx > 0 ? 1 : 0)) % 4]), 1, 0);
      this.scene.add(r.mesh());
    }
    // REWE-Lieferwagen vor dem Lager (bringt die Paletten)
    const lw = new Bau(), rot = hex(0xcc071e), weiss = hex(0xf4f4f4), dunkel = hex(0x2c2e31);
    const lx = 5.5, lz = -7.2;
    lw.box(lx - 1.2, 1.75, lz, 6.4, 2.9, 2.5, weiss).box(lx - 1.2, 0.75, lz + 1.27, 6.4, 0.5, 0.02, rot, 1, 0).box(lx - 1.2, 0.75, lz - 1.27, 6.4, 0.5, 0.02, rot, 1, 0);
    lw.box(lx - 1.2, 3.22, lz, 6.4, 0.06, 2.5, hex(0xe0e0e0));
    lw.box(lx + 3.0, 1.35, lz, 1.9, 2.1, 2.4, rot).box(lx + 3.75, 1.85, lz, 0.5, 0.8, 2.2, hex(0x9fc3d8)).box(lx + 3.0, 0.45, lz, 2.0, 0.5, 2.45, dunkel);
    for (const wx of [lx - 3.3, lx - 1.6, lx + 3.0]) for (const s of [-1, 1]) lw.box(wx, 0.45, lz + s * 1.2, 0.9, 0.9, 0.35, dunkel);
    const truck = lw.mesh(); this.scene.add(truck);
    this.schatten(lx, lz, 10, 4.5, 0.5);
    // Logo-Schild auf der Seite des Wagens (zur Kamera)
    const logo = new THREE.TextureLoader().load('../shared/img/logo.png'); logo.colorSpace = THREE.SRGBColorSpace;
    const schild = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: logo, transparent: true }));
    schild.position.set(lx - 1.2, 1.9, lz + 1.27); this.scene.add(schild);
    // Garten jenseits der Straße: Rasen, Kieswege, Hecken, Beete mit Büschen, Bäume und Bänke
    boden(-30, -14.3, 80, 0.3, 0xd0ccc2, 0.0);                                     // Bordstein
    const kies = canvasTex(64, 64, (g) => { g.fillStyle = '#d8ccae'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.25})`; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); } }, [20, 1]);
    boden(-30, -21.5, 80, 1.6, 0xffffff, -0.02, kies);                              // Weg quer
    const kies2 = kies.clone(); kies2.repeat.set(1, 6); kies2.needsUpdate = true;
    for (const x of [3.2, 20.5]) boden(x, -32, 1.6, 17.8, 0xffffff, -0.021, kies2);  // Wege zur Straße
    const g = new Bau(), hecke = hex(0x4f8a35), hecke2 = hex(0x5f9a3f);
    g.box(-8, 0.45, -15.4, 10.8, 0.9, 0.9, hecke).box(12, 0.45, -15.4, 15.5, 0.9, 0.9, hecke2).box(32, 0.45, -15.4, 21, 0.9, 0.9, hecke);
    for (const [x, z] of [[-6, -26], [11.8, -27], [28, -26.5]]) {                   // Beete mit runden Büschen
      g.box(x, 0.12, z, 5.2, 0.24, 3.2, hex(0x6b4a32));
      for (let i = 0; i < 5; i++) g.ei(x - 2 + i, 0.5 + (i % 2) * 0.12, z + (i % 2 ? 0.5 : -0.4), 0.55, 0.45, 0.55, hex(i % 2 ? 0x6faa3e : 0x4f8a35), 8, 6);
    }
    for (const [x, z] of [[1.2, -19.6], [18.4, -19.6], [9.5, -23.4]]) {             // Bänke
      g.box(x, 0.45, z, 2.0, 0.08, 0.5, hex(0xa0703f)).box(x, 0.75, z - 0.24, 2.0, 0.4, 0.06, hex(0xa0703f));
      for (const sx of [-0.85, 0.85]) g.box(x + sx, 0.22, z, 0.08, 0.44, 0.5, hex(0x3a3a3e));
    }
    this.scene.add(g.mesh());
    for (const [x, z, s] of [[-12, -25, 1.4], [-2.5, -30, 1.2], [7, -28.5, 1.5], [15.5, -24.5, 1.1], [24, -30, 1.4], [34, -24, 1.3], [-9, -18.5, 1.0], [27.5, -19, 1.05]]) this.baum(x, z, s);
    // Bäume und Büsche entlang der Straße
    for (const [x, z, s] of [[-8, -2.2, 1.1], [13.5, -2.0, 1.0], [30, -2.4, 1.2], [36, 6, 1.3], [33, 14, 1.0], [34, 24, 1.2], [-12, -1.5, 0.9]]) this.baum(x, z, s);
    for (const [x, z] of [[-3, -1.2], [2.4, -1.0], [10.5, -1.1]]) {
      this.scene.add(new Bau().ei(x, 0.35, z, 0.9, 0.5, 0.6, hex(0x5f9a35), 9, 6).ei(x + 0.5, 0.45, z - 0.1, 0.6, 0.45, 0.5, hex(0x7cb342), 9, 6).mesh());
    }
  }
  baum(x, z, s) {
    const b = new Bau();
    b.box(x, 0.3 * s, z, 1.1 * s, 0.6 * s, 1.1 * s, hex(0x8a6a4a)).box(x, 0.62 * s, z, 0.9 * s, 0.05, 0.9 * s, hex(0x4a3a2a));
    b.box(x, 1.1 * s, z, 0.18 * s, 1.0 * s, 0.18 * s, hex(0x6b4a2e));
    for (const [dx, dy, dz, r] of [[0, 2.0, 0, 0.9], [-0.5, 1.75, 0.2, 0.6], [0.5, 1.8, -0.1, 0.65], [0.1, 2.45, -0.15, 0.6], [0.2, 1.7, 0.5, 0.55]]) {
      b.ei(x + dx * s, dy * s, z + dz * s, r * s, r * 0.85 * s, r * s, hex(dy > 2.2 ? 0x7cb342 : 0x5f9a35), 9, 6);
    }
    const m = b.mesh(); this.scene.add(m); this.schatten(x + 0.4 * s, z - 0.3 * s, 2.6 * s, 2.0 * s, 0.6);
  }
  topfpflanze(x, z) {
    const b = new Bau().box(x, 0.3, z, 0.6, 0.6, 0.6, hex(0xcc071e)).box(x, 0.62, z, 0.5, 0.04, 0.5, hex(0x4a3a2a));
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; b.ei(x + Math.cos(a) * 0.28, 0.95 + (i % 2) * 0.15, z + Math.sin(a) * 0.28, 0.12, 0.38, 0.12, hex(0x4f9a3a), 6, 5); }
    this.scene.add(b.mesh()); this.schatten(x, z, 1.1, 1.1, 0.45);
  }
  schatten(x, z, sx, sz, a) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: this.blob, transparent: true, opacity: a, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.015, z); this.scene.add(m); return m;
  }

  baueMarkierungen() {
    // leuchtende Bodenmarkierung unter jeder Station (Auftrag offen = rot, nächstes Ziel = gelb)
    this.mark = new Map();
    for (const s of this.og.stationen) {
      const b = s.body;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b[2] + 0.8, b[3] + 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.order = 'YXZ'; m.rotation.y = -b[4] * D2R; m.rotation.x = -Math.PI / 2;
      m.position.set(b[0], 0.02, b[1]); this.scene.add(m);
      this.mark.set(s.id, m);
    }
  }

  // ---------- Figuren ----------
  teddy() {
    const g = new THREE.Group();
    const body = meshFromOps(this.teddyOps); g.add(body);
    g.scale.setScalar(2.1);
    return { g, body };
  }
  azubi() {
    // Azubi: rotes REWE-Shirt, dunkle Hose, Namensschild
    const b = new Bau(), haut = hex(0xf0c9a5), shirt = hex(0xcc071e), hose = hex(0x34363b);
    for (const sx of [-1, 1]) { b.box(sx * 0.12, 0.38, 0, 0.17, 0.76, 0.2, hose); b.box(sx * 0.12, 0.05, 0.05, 0.18, 0.1, 0.3, hex(0x1e1e20)); }
    b.ei(0, 0.98, 0, 0.27, 0.34, 0.2, shirt, 12, 8);
    b.box(-0.13, 1.08, 0.19, 0.14, 0.07, 0.02, hex(0xffffff), 1, 0);
    for (const sx of [-1, 1]) { b.ei(sx * 0.3, 1.02, 0.18, 0.08, 0.08, 0.24, shirt); b.ei(sx * 0.3, 1.04, 0.42, 0.07, 0.07, 0.07, haut); }
    b.ei(0, 1.5, 0, 0.22, 0.24, 0.22, haut, 12, 8);
    b.ei(0, 1.62, -0.03, 0.235, 0.17, 0.235, hex(0x5a3a22), 12, 8);
    for (const sx of [-1, 1]) b.ei(sx * 0.08, 1.52, 0.2, 0.03, 0.035, 0.02, hex(0x1e1e20), 6, 4);
    const g = new THREE.Group(); const body = b.mesh(); g.add(body); g.scale.setScalar(1.95);
    return { g, body };
  }
  figurAnlegen(key) {
    const f = key === 'teddy' ? this.teddy() : this.azubi();
    f.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 40), new THREE.MeshBasicMaterial({ color: 0xf5b400, transparent: true, opacity: 0.9, depthWrite: false }));
    f.ring.rotation.x = -Math.PI / 2; f.ring.position.y = 0.03;
    f.pfeil = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xf5b400 }));
    f.pfeil.rotation.x = Math.PI;
    f.sch = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: this.blob, transparent: true, opacity: 0.6, depthWrite: false }));
    f.sch.rotation.x = -Math.PI / 2; f.sch.position.y = 0.02;
    f.hand = new THREE.Group(); f.hand.position.set(0, 1.0, -0.62); f.body.add(f.hand);
    f.holdKey = '';
    const outer = new THREE.Group(); outer.add(f.g, f.ring, f.pfeil, f.sch);
    f.outer = outer; this.scene.add(outer);
    this.figuren[key] = f;
    return f;
  }

  kiste(c, sieht) {
    // IFCO-Kiste mit Ware; roh = noch in Folie, bereit = mit Preisschild
    const b = new Bau(), farbe = WARE_FARBE[c.ware] || [[0.6, 0.6, 0.6], [0.5, 0.5, 0.5]];
    b.box(0, 0.16, 0, 0.6, 0.32, 0.42, hex(0xe88a2a)).box(0, 0.31, 0, 0.54, 0.02, 0.36, hex(0xb8601a));
    for (let i = 0; i < 6; i++) {
      const x = -0.18 + (i % 3) * 0.18, z = i < 3 ? -0.09 : 0.09, col = farbe[(i + (i > 2 ? 1 : 0)) % 2];
      if (c.ware === 'smoothies') b.box(x, 0.42, z, 0.1, 0.24, 0.1, col);
      else if (c.ware === 'bananen') b.ei(x, 0.36, z, 0.11, 0.05, 0.07, col, 8, 5);
      else if (c.ware === 'salate') b.ei(x, 0.38, z, 0.1, 0.08, 0.1, col, 8, 5);
      else b.ei(x, 0.37, z, 0.075, 0.07, 0.075, col, 8, 5);
    }
    if (c.bad && sieht) { b.ei(0.18, 0.43, 0.09, 0.07, 0.05, 0.07, hex(0x5b3d14), 8, 5); b.ei(-0.05, 0.43, -0.08, 0.05, 0.04, 0.05, hex(0x5b3d14), 8, 5); }
    if (c.state === 'bereit') b.box(0.2, 0.46, 0.22, 0.2, 0.12, 0.02, hex(0xffe14d), 1, 0);
    const g = new THREE.Group(); g.add(b.mesh());
    if (c.state === 'roh') {
      const folie = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.5, 0.46), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.38, depthWrite: false }));
      folie.position.y = 0.25; g.add(folie);
    }
    return g;
  }
  leerKisten(n, flach) {
    const b = new Bau(), c = hex(0x7d9bb0), d = hex(0x4f6c80);
    if (flach) for (let i = 0; i < n; i++) b.box(0, 0.04 + i * 0.09, 0, 0.62, 0.08, 0.44, i % 2 ? d : c);
    else b.box(0, 0.16, 0, 0.6, 0.32, 0.42, c).box(0, 0.3, 0, 0.5, 0.03, 0.32, d).box(0, 0.12, 0.215, 0.4, 0.06, 0.02, d);
    return b.mesh();
  }

  // ---------- Kamera ----------
  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    const cam = this.camera, W = this.og.breite, H = this.og.hoehe;
    cam.aspect = w / h; cam.clearViewOffset();
    const tx = W / 2, tz = H / 2 + 1.2;
    const pts = [];
    for (const [x, z] of [[0.5, 0], [W - 0.3, 0], [0.5, H], [W - 0.3, H]]) for (const y of [0, 1.2]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 10, hi = 200;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      cam.position.set(tx, d * Math.sin(ELEV), tz + d * Math.cos(ELEV)); cam.lookAt(tx, 0, tz);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const ok = pts.every(p => { const v = p.clone().project(cam); return Math.abs(v.x) <= 0.99 && Math.abs(v.y) <= 0.99; });
      if (ok) hi = d; else lo = d;
    }
    const d = hi;
    cam.position.set(tx, d * Math.sin(ELEV), tz + d * Math.cos(ELEV)); cam.lookAt(tx, 0, tz);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // Spielfeld unten ausrichten (Daumennähe), oben bleibt Platz für Hinweise
    let bottom = 0, top = h;
    for (const p of pts) { const v = p.clone().project(cam); const py = (1 - v.y) / 2 * h; bottom = Math.max(bottom, py); top = Math.min(top, py); }
    this.offY = Math.min(0, bottom - h + 4);
    if (this.offY) cam.setViewOffset(w, h, 0, this.offY, w, h);
    cam.updateProjectionMatrix();
    this.top = top - this.offY;
  }
  // Welt -> Bildschirm (CSS-Pixel)
  screen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h, v.z];
  }
  // Bildschirm -> Boden in gegebener Höhe
  ground(px, py, height = 0) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(px / this.w * 2 - 1, 1 - py / this.h * 2), this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), hit) ? [hit.x, hit.z] : null;
  }

  // ---------- Bild für Bild ----------
  update(G, dt, aktiv, wunsch, ziel) {
    this.t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    for (const [id, m] of this.mark) {
      const s = this.og.stationen.find(x => x.id === id);
      let c = null;
      if (ziel.has(id)) c = 0xf5b400; else if (s.ware && wunsch.has(s.ware)) c = 0xe2231a;
      m.material.opacity = c ? 0.3 + 0.35 * pulse : 0;
      if (c) m.material.color.setHex(c);
    }
    // Palette
    const sieht = aktiv && aktiv.sees;
    const key = G ? G.palette.map(c => `${c.id}${c.bad && sieht ? 'x' : ''}`).join(',') : '';
    if (key !== this.kistenKey) {
      this.kistenKey = key; this.paletteGrp.clear();
      const p = this.paletteBody;
      (G ? G.palette : []).slice(0, 6).forEach((c, i) => {
        const k = this.kiste(c, sieht);
        k.position.set(p[0] + (i % 2 ? 0.55 : -0.55), 0.19 + Math.floor(i / 4) * 0.55, p[1] + ((i % 4) < 2 ? -0.6 : 0.6));
        k.scale.setScalar(1.3);
        this.paletteGrp.add(k);
      });
    }
    if (!G) return;
    // Figuren
    for (const fg of Object.values(G.fig)) {
      const f = this.figuren[fg.key] || this.figurAnlegen(fg.key);
      const moving = fg.path.length > 0 || (G.joy && G.joy.fig === fg && (G.joy.vx || G.joy.vy));
      f.phase = (f.phase || 0) + dt * (moving ? 11 : 0);
      f.outer.position.set(fg.x, 0, fg.y);
      if (moving) f.dir = fg.dir;
      f.g.rotation.y = heading(f.dir ?? Math.PI / 2);
      f.body.position.y = moving ? Math.abs(Math.sin(f.phase)) * 0.08 : 0;
      f.body.rotation.z = moving ? Math.sin(f.phase) * 0.08 : (fg.work ? Math.sin(this.t * 18) * 0.04 : 0);
      const isA = G.active === fg.key;
      f.ring.visible = isA; f.pfeil.visible = isA;
      f.ring.material.opacity = 0.6 + 0.3 * pulse;
      f.pfeil.position.set(0, 4.5 + 0.2 * Math.sin(this.t * 4), 0); f.pfeil.rotation.y = this.t * 2;
      const hk = !fg.hold ? '' : fg.hold.typ === 'leer' ? `L${fg.hold.n}` : fg.hold.typ === 'retoure' ? `R${fg.hold.n}` : `${fg.hold.id}${fg.hold.state}${fg.hold.bad && fg.sees ? 'x' : ''}`;
      if (hk !== f.holdKey) {
        f.holdKey = hk; f.hand.clear();
        if (fg.hold && fg.hold.typ === 'retoure') {
          for (let i = 0; i < fg.hold.n; i++) { const k = this.retoureKiste(); k.position.y = i * 0.3; f.hand.add(k); }
        } else if (fg.hold) f.hand.add(fg.hold.typ === 'leer' ? this.leerKisten(fg.hold.n, true) : this.kiste(fg.hold, fg.sees));
        f.hand.scale.setScalar(fg.key === 'teddy' ? 0.8 : 0.85);
      }
    }
    // Retoure: Kisten auf dem Sortiertisch und abgestellte Kisten in der Gitterbox
    if (this.tischZahl !== G.retoureTisch) {
      this.tischZahl = G.retoureTisch; this.tischRetoure.clear();
      for (let i = 0; i < G.retoureTisch; i++) { const k = this.retoureKiste(); k.position.set(i * 0.62, 0, 0); this.tischRetoure.add(k); }
    }
    const n = Math.min(8, G.stats.retoure);
    if (this.retoureZahl !== n) {
      this.retoureZahl = n; this.retoureInhalt.clear();
      for (let i = 0; i < n; i++) { const k = this.retoureKiste(); k.position.set((i % 2 ? 0.45 : -0.45), 0.15 + Math.floor(i / 2) * 0.3, (i % 4 < 2 ? 0 : 0)); k.scale.setScalar(1.25); this.retoureInhalt.add(k); }
    }
    // Kunden
    const seen = new Set();
    G.kunden.forEach((k, i) => {
      if (!k.id) k.id = ++this.kid || (this.kid = 1);
      seen.add(k.id);
      let o = this.kunden.get(k.id);
      if (!o) {
        const g = new THREE.Group(), body = meshFromOps(this.kundenOps[k.id % this.kundenOps.length]);
        g.add(body);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: this.blob, transparent: true, opacity: 0.5, depthWrite: false }));
        s.rotation.x = -Math.PI / 2; s.position.y = 0.02;
        const outer = new THREE.Group(); outer.add(g, s); outer.scale.setScalar(1.7);
        this.scene.add(outer); o = { outer, g, body, phase: 0 }; this.kunden.set(k.id, o);
      }
      const moving = k.state !== 'stehen';
      o.phase += dt * (moving ? 9 : 0);
      o.outer.position.set(k.x, 0, k.y);
      if (moving && k.path.length) o.dir = k.dir;
      o.g.rotation.y = heading(o.dir ?? Math.PI / 2);
      o.body.position.y = moving ? Math.abs(Math.sin(o.phase)) * 0.05 : 0;
    });
    for (const [id, o] of this.kunden) if (!seen.has(id)) { this.scene.remove(o.outer); this.kunden.delete(id); }
    // Leergut am Boden
    const lseen = new Set();
    for (const l of G.leergut) {
      lseen.add(l.id);
      let m = this.leergut.get(l.id);
      if (!m) { m = this.leerKisten(1, false); m.scale.setScalar(1.7); m.rotation.y = (l.id % 5) * 0.3; this.scene.add(m); this.leergut.set(l.id, m); }
      const s = Math.min(1, l.t / 0.25);
      m.position.set(l.x, 0.6 * (1 - s), l.y);
    }
    for (const [id, m] of this.leergut) if (!lseen.has(id)) { this.scene.remove(m); this.leergut.delete(id); }
  }
  reset() {
    for (const o of this.kunden.values()) this.scene.remove(o.outer);
    for (const m of this.leergut.values()) this.scene.remove(m);
    this.kunden.clear(); this.leergut.clear(); this.kistenKey = '?';
    for (const f of Object.values(this.figuren)) { f.holdKey = '?'; }
    this.tischZahl = -1; this.retoureZahl = -1;
  }
  render() { this.renderer.render(this.scene, this.camera); }
}

// Laufrichtung (Bildschirmwinkel) -> Drehung des Modells, das in -z schaut
const heading = d => Math.atan2(-Math.cos(d), -Math.sin(d));

function place(obj, it) {
  const [x, y, z] = it.pos;
  obj.position.set(x, y, -z);
  obj.rotation.order = 'YXZ';
  obj.rotation.y = -(it.ry || 0) * D2R;
  obj.rotation.x = -(it.rx || 0) * D2R;
}
function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
}
