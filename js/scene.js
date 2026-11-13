// Baut den Markt aus web/data/szene.json (exportiert aus dem Desktop-Spiel) auf.
import * as THREE from 'three';
import { chunkedMeshes, meshFromOps, vertexMaterial } from './meshops.js';

const loader = new THREE.TextureLoader();
const texCache = new Map();

export function tex(url) {
  if (!texCache.has(url)) {
    const t = loader.load(url);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

const D2R = Math.PI / 180;

function place(obj, it) {
  const [x, y, z] = it.pos;
  obj.position.set(x, y, -z);
  // Ursina-Drehung in Three.js-Drehung umrechnen (z ist gespiegelt)
  obj.rotation.order = 'YXZ';
  obj.rotation.y = -(it.ry || 0) * D2R;
  obj.rotation.x = -(it.rx || 0) * D2R;
}

function colorOf(c) {
  return c ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(1, 1, 1);
}

export function softShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.5, 'rgba(0,0,0,.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function textTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${color.map(v => v * 255).join(',')})`;
  g.font = 'bold 100px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Market {
  constructor(scene, data, layout) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.groups = new Map();     // Regalreihe -> {mesh, x0, x1, z1}
    this.signs = [];             // {mesh, x, z}
    const sharedMat = vertexMaterial(false);

    for (const it of data.items) {
      let obj = null;
      if (it.type === 'mesh') {
        if (it.group !== undefined) {
          obj = meshFromOps(it.ops, vertexMaterial(true));
          obj.material.depthWrite = true;
          const [x0, x1, z1] = layout.groups[it.group];
          this.groups.set(it.group, { mesh: obj, x0, x1, z1, alpha: 1 });
        } else if (it.ops.length > 400 && !it.ry) {
          const g = new THREE.Group();
          for (const m of chunkedMeshes(it.ops, sharedMat)) g.add(m);
          obj = g;
        } else {
          obj = meshFromOps(it.ops);
        }
        place(obj, it);
        const s = it.scale;
        if (typeof s === 'number') obj.scale.setScalar(s);
      } else if (it.type === 'quad') {
        const [sx, sy] = Array.isArray(it.scale) ? it.scale : [it.scale, it.scale];
        const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
        if (it.tex) { mat.map = tex(`img/tex/${it.tex}.png`); mat.alphaTest = 0.02; }
        if (it.color) { mat.color = colorOf(it.color); mat.opacity = it.color[3]; }
        obj = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat);
        place(obj, it);
        if (it.sign !== undefined) this.signs.push({ mesh: obj, x: it.pos[0], z: it.pos[2], alpha: 1 });
      } else if (it.type === 'plane') {
        const [sx, , sz] = it.scale;
        const t = loader.load(`img/tex/${it.tex}.png`);      // eigene Textur, weil sie gekachelt wird
        t.colorSpace = THREE.NoColorSpace;
        t.anisotropy = 8;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(sx / 2, sz / 2);
        obj = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: t }));
        obj.rotation.x = -Math.PI / 2;
        obj.position.set(it.pos[0], it.pos[1], -it.pos[2]);
      } else if (it.type === 'cube') {
        const s = it.scale;
        obj = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), new THREE.MeshBasicMaterial({ color: colorOf(it.color) }));
        place(obj, it);
      } else if (it.type === 'circle') {
        const s = typeof it.scale === 'number' ? it.scale : it.scale[0];
        obj = new THREE.Mesh(new THREE.CircleGeometry(s / 2, 32), new THREE.MeshBasicMaterial({
          color: colorOf(it.color), transparent: true, opacity: it.color ? it.color[3] : 1 }));
        place(obj, it);
      } else if (it.type === 'text') {
        const h = 0.025 * (typeof it.scale === 'number' ? it.scale : 18) * 1.1;
        obj = new THREE.Mesh(new THREE.PlaneGeometry(h, h), new THREE.MeshBasicMaterial({
          map: textTexture(it.text, it.color || [1, 1, 1]), transparent: true, side: THREE.DoubleSide }));
        place(obj, it);
        obj.position.z += 0.02;
      }
      if (obj) this.root.add(obj);
    }

    // gelbe Bodenmarkierung der aktiven Abteilung
    this.highlight = new THREE.Group();
    const hq = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 220 / 255, 0), transparent: true, opacity: 0.43, depthWrite: false }));
    hq.rotation.x = -Math.PI / 2;
    this.highlightQuad = hq;
    this.highlight.add(hq);
    this.highlight.visible = false;
    this.root.add(this.highlight);
    this.puddleGroup = new THREE.Group();
    this.root.add(this.puddleGroup);
  }

  setPuddles(list) {
    this.puddleGroup.clear();
    const signMat = new THREE.MeshBasicMaterial({ map: tex('img/pfuetze.png'), transparent: true, side: THREE.DoubleSide });
    for (const [x, z] of list) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({
        color: new THREE.Color(90 / 255, 170 / 255, 1), transparent: true, opacity: 110 / 255, depthWrite: false }));
      c.rotation.x = -Math.PI / 2;
      c.position.set(x, 0.02, -z);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.84), signMat);
      s.position.set(x + 1.0, 0.5, -(z - 0.6));
      s.rotation.x = -35 * D2R;
      this.puddleGroup.add(c, s);
    }
  }

  showHighlight(zone, t) {
    if (!zone) { this.highlight.visible = false; return; }
    const [cx, cz, w, d, angle] = zone;
    this.highlight.visible = true;
    this.highlight.position.set(cx, 0.03, -cz);
    this.highlight.rotation.y = angle * D2R;
    this.highlightQuad.scale.set(w, d, 1);
    this.highlightQuad.material.opacity = 0.35 + 0.2 * Math.abs(((t * 2) % 2) - 1);
  }

  fadeRows(px, pz) {
    for (const g of this.groups.values()) {
      const behind = g.z1 - 0.5 < pz && pz < g.z1 + 3.5 && g.x0 - 1.2 < px && px < g.x1 + 1.2;
      g.alpha += ((behind ? 0.35 : 1) - g.alpha) * 0.2;
      g.mesh.material.opacity = g.alpha;
      g.mesh.material.transparent = g.alpha < 0.99;
    }
    for (const s of this.signs) {
      const behind = 0 < pz - s.z && pz - s.z < 3.5 && Math.abs(px - s.x) < 2.0;
      s.alpha += ((behind ? 0.35 : 1) - s.alpha) * 0.2;
      s.mesh.material.opacity = s.alpha;
    }
  }
}
