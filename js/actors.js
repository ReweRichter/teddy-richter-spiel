// Spielfigur Teddy mit Wagen, andere Kunden und der Mitarbeiter mit Hubwagen (wie game/actors.py).
import * as THREE from 'three';
import { meshFromOps } from './meshops.js';

// ---------- Rechtecke (evtl. gedreht) und Kollision ----------
export function boxAxes(b) {
  const a = b[4] * Math.PI / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
}
export function boxLocal(b, x, z) {
  const [ux, uz, vx, vz] = boxAxes(b);
  const dx = x - b[0], dz = z - b[1];
  return [dx * ux + dz * uz, dx * vx + dz * vz];
}
export function boxContains(b, x, z) {
  const [lx, lz] = boxLocal(b, x, z);
  return Math.abs(lx) <= b[2] / 2 && Math.abs(lz) <= b[3] / 2;
}
export function boxNearest(b, x, z) {
  let [lx, lz] = boxLocal(b, x, z);
  lx = Math.max(-b[2] / 2, Math.min(b[2] / 2, lx));
  lz = Math.max(-b[3] / 2, Math.min(b[3] / 2, lz));
  const [ux, uz, vx, vz] = boxAxes(b);
  return [b[0] + lx * ux + lz * vx, b[1] + lx * uz + lz * vz];
}

function pushOutBox(px, pz, r, b) {
  const [lx, lz] = boxLocal(b, px, pz);
  const hw = b[2] / 2, hd = b[3] / 2;
  if (Math.abs(lx) > hw + r || Math.abs(lz) > hd + r) return null;
  const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hd, Math.min(hd, lz));
  let dx = lx - cx, dz = lz - cz, nx, nz, depth;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; nz = dz / d; depth = r - d;
  } else {
    const opts = [[lx + hw, -1, 0], [hw - lx, 1, 0], [lz + hd, 0, -1], [hd - lz, 0, 1]];
    opts.sort((a, c) => a[0] - c[0]);
    [depth, nx, nz] = opts[0];
    depth += r;
  }
  const [ux, uz, vx, vz] = boxAxes(b);
  return [nx * ux + nz * vx, nx * uz + nz * vz, depth];
}

export function pushOutCircle(px, pz, r, cx, cz, cr) {
  const dx = px - cx, dz = pz - cz, rr = r + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  return [dx / d, dz / d, rr - d];
}

function pushOutLine(px, pz, r, a, b, thick = 0.25) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2));
  return pushOutCircle(px, pz, r, a[0] + t * dx, a[1] + t * dz, thick);
}

function turnTowards(a, target, maxStep) {
  const diff = ((target - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + Math.max(-maxStep, Math.min(maxStep, diff));
}

// Spielkoordinaten (x, z) -> Three.js
function setPos(obj, x, z, y = 0) { obj.position.set(x, y, -z); }
function setHeading(obj, h) { obj.rotation.y = -h; }

function shadow(parent, z, sx, sz, alpha, shadowTex) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, opacity: alpha, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.012, -z);
  parent.add(m);
  return m;
}

// ---------- Teddy ----------
export class Player {
  static R = 0.85;
  static ACCEL = 24.0;
  static MAX_SPEED = 8.5;

  constructor(parent, start, heading, meshes, shadowTex) {
    [this.x, this.z] = start;
    this.vx = this.vz = 0;
    this.heading = heading;
    this.t = 0;
    this.root = new THREE.Group();
    this.root.scale.setScalar(1.2);
    this.body = meshFromOps(meshes.teddy);
    this.body.position.z = 0.55;          // Teddy steht hinter dem Wagen
    this.cart = meshFromOps(meshes.cart);
    this.root.add(this.body, this.cart);
    shadow(this.root, 0.1, 1.8, 2.9, 0.5, shadowTex);
    this.items = new THREE.Group();
    this.root.add(this.items);
    this.nItems = 0;
    parent.add(this.root);
    this.sync();
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  slipAngle() {
    if (this.speed < 0.5) return 0;
    let d = Math.atan2(this.vx, this.vz) - this.heading;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(d);
  }

  update(dt, ix, iz, wet, boxes, circles, walls) {
    this.t += dt;
    const steering = ix || iz;
    const accel = Player.ACCEL * (wet ? 0.3 : 1);
    const drag = wet ? 0.35 : (steering ? 2.0 : 5.5);
    this.vx += ix * accel * dt;
    this.vz += iz * accel * dt;
    const damp = Math.exp(-drag * dt);
    this.vx *= damp; this.vz *= damp;
    const sp = this.speed, cap = Player.MAX_SPEED * (wet ? 1.15 : 1);
    if (sp > cap) { this.vx *= cap / sp; this.vz *= cap / sp; }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    let impact = 0;
    const R = Player.R;
    const hits = [];
    for (const b of boxes) { const h = pushOutBox(this.x, this.z, R, b); if (h) hits.push(h); }
    for (const c of circles) { const h = pushOutCircle(this.x, this.z, R, c[0], c[1], c[2]); if (h) hits.push(h); }
    for (const w of walls) { const h = pushOutLine(this.x, this.z, R, w[0], w[1]); if (h) hits.push(h); }
    for (const [nx, nz, depth] of hits) {
      this.x += nx * depth; this.z += nz * depth;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        this.vx -= 1.4 * vn * nx; this.vz -= 1.4 * vn * nz;
        if (-vn > 2.5) { this.vx *= 0.55; this.vz *= 0.55; }
      }
    }
    if (this.speed > 0.4) {
      this.heading = turnTowards(this.heading, Math.atan2(this.vx, this.vz), (wet ? 2.2 : 6.5) * dt);
    } else if (steering) {
      this.heading = turnTowards(this.heading, Math.atan2(ix, iz), 8 * dt);
    }
    const k = Math.min(1, this.speed / 4);
    this.body.position.y = Math.abs(Math.sin(this.t * 11)) * 0.07 * k;
    this.body.rotation.z = Math.sin(this.t * 11) * 5 * k * Math.PI / 180;
    this.sync();
    return impact;
  }

  sync() { setPos(this.root, this.x, this.z); setHeading(this.root, this.heading); }

  cartSlot(i) {
    const col = i % 3, row = Math.floor(i / 3) % 3, layer = Math.floor(i / 9);
    return [-0.2 + 0.2 * col, 0.64 + 0.2 * layer, 0.12 + 0.3 * row];
  }

  worldCartPoint() {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    return [this.x + s * 0.45 * 1.2, 1.2, this.z + c * 0.45 * 1.2];
  }

  addItem(color, iconTex) {
    const [x, y, z] = this.cartSlot(this.nItems++);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color }));
    cube.position.set(x, y, -z);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex }));
    sp.scale.setScalar(0.34);
    sp.position.set(x, y + 0.25, -z);
    this.items.add(cube, sp);
  }

  dispose() { this.root.parent?.remove(this.root); }
}

// ---------- andere Kunden ----------
export class Customer {
  static R = 0.8;

  constructor(parent, lay, rng, ops, cartOps, shadowTex) {
    this.lay = lay;
    this.rng = rng;
    const n = lay.navNodes.length;
    this.prev = Math.floor(rng() * n);
    [this.x, this.z] = lay.navNodes[this.prev];
    const nb = lay.navEdges[this.prev];
    this.target = nb[Math.floor(rng() * nb.length)];
    this.speed = 1.5 + rng() * 0.8;
    this.heading = 0;
    this.wait = 0;
    this.t = rng() * 5;
    this.root = new THREE.Group();
    this.body = meshFromOps(ops);
    this.root.add(this.body, meshFromOps(cartOps));
    shadow(this.root, 0.1, 1.7, 2.8, 0.4, shadowTex);
    const k = 2 + Math.floor(rng() * 5);
    for (let i = 0; i < k; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rng(), 0.7, 0.55) }));
      c.position.set(-0.2 + 0.2 * (i % 3), 0.64, -(0.12 + 0.3 * Math.floor(i / 3)));
      this.root.add(c);
    }
    parent.add(this.root);
    setPos(this.root, this.x, this.z);
  }

  pickNext() {
    const opts = this.lay.navEdges[this.target].filter(n => n !== this.prev);
    const list = opts.length ? opts : [this.prev];
    this.prev = this.target;
    this.target = list[Math.floor(this.rng() * list.length)];
  }

  update(dt, player, others, blockers) {
    const [tx, tz] = this.lay.navNodes[this.target];
    const dx = tx - this.x, dz = tz - this.z, dist = Math.hypot(dx, dz);
    if (dist < 0.1) { this.pickNext(); return; }
    const ux = dx / dist, uz = dz / dist;
    const ax = this.x + ux * 1.9, az = this.z + uz * 1.9;
    let blocked = Math.hypot(ax - player.x, az - player.z) < Customer.R + 0.85 + 0.1;
    for (const o of others) if (o !== this && Math.hypot(ax - o.x, az - o.z) < 1.4) blocked = true;
    for (const c of blockers) {
      if (c.length === 5 ? boxContains(c, ax, az) : Math.hypot(ax - c[0], az - c[1]) < c[2] + 0.6) blocked = true;
    }
    if (blocked) {
      this.wait += dt;
      if (this.wait > 1.6) { [this.prev, this.target] = [this.target, this.prev]; this.wait = 0; }
      return;
    }
    this.wait = 0;
    const step = Math.min(dist, this.speed * dt);
    this.x += ux * step; this.z += uz * step;
    this.t += dt;
    this.heading = turnTowards(this.heading, Math.atan2(ux, uz), 5 * dt);
    setPos(this.root, this.x, this.z);
    setHeading(this.root, this.heading);
    this.body.position.y = Math.abs(Math.sin(this.t * 8)) * 0.04;
  }

  get circle() { return [this.x, this.z, Customer.R]; }
}

// ---------- Mitarbeiter mit Hubwagen: stellt sich quer und sperrt einen Gang ----------
export class PalletWorker {
  static R = 1.0;
  static SPEED = 2.4;
  static PARK = 7.0;

  constructor(parent, lay, rng, ops, shadowTex) {
    this.lay = lay;
    this.rng = rng;
    [this.zb, this.zt] = lay.corridorZ;
    this.aisle = Math.floor(rng() * lay.innerAisles.length);
    this.x = lay.innerAisles[this.aisle][0];
    this.z = this.zt;
    this.heading = Math.PI;
    this.state = 'drive';
    this.timer = 0;
    this.block = null;
    this.root = new THREE.Group();
    this.root.add(meshFromOps(ops));
    shadow(this.root, -0.3, 1.9, 4.4, 0.4, shadowTex);
    parent.add(this.root);
    this.planNext();
    this.sync();
  }

  sync() { setPos(this.root, this.x, this.z); setHeading(this.root, this.heading); }

  planNext() {
    const n = this.lay.innerAisles.length;
    const opts = [...Array(n).keys()].filter(i => i !== this.aisle);
    this.aisle = opts.length ? opts[Math.floor(this.rng() * opts.length)] : this.aisle;
    const ax = this.lay.innerAisles[this.aisle][0];
    const corridor = Math.abs(this.z - this.zt) < Math.abs(this.z - this.zb) ? this.zt : this.zb;
    this.parkZ = this.zb + 4.5 + this.rng() * (this.zt - this.zb - 9);
    this.waypoints = [[this.x, corridor], [ax, corridor], [ax, this.parkZ]];
    this.state = 'drive';
  }

  update(dt, player) {
    if (this.state === 'park') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.block = null;
        this.state = 'leave';
        const ax = this.lay.innerAisles[this.aisle][0];
        this.waypoints = [[ax, this.rng() < 0.5 ? this.zb : this.zt]];
      }
      return;
    }
    if (!this.waypoints.length) {
      if (this.state === 'leave') { this.planNext(); return; }
      if (Math.hypot(player.x - this.x, player.z - this.z) < 3.2) return;
      const [ax, aw] = this.lay.innerAisles[this.aisle];
      this.block = [ax, this.parkZ, aw, 1.3, 0];
      this.heading = Math.PI / 2;
      this.x = ax + 0.45;
      this.z = this.parkZ;
      this.sync();
      this.state = 'park';
      this.timer = PalletWorker.PARK;
      return;
    }
    const [tx, tz] = this.waypoints[0];
    const dx = tx - this.x, dz = tz - this.z, dist = Math.hypot(dx, dz);
    if (dist < 0.1) { this.waypoints.shift(); return; }
    if (Math.hypot(player.x - (this.x + dx / dist * 2.2), player.z - (this.z + dz / dist * 2.2)) < 1.9) return;
    const step = Math.min(dist, PalletWorker.SPEED * dt);
    this.x += dx / dist * step; this.z += dz / dist * step;
    this.heading = turnTowards(this.heading, Math.atan2(dx, dz), 4 * dt);
    this.sync();
  }

  get obstacle() { return this.block || [this.x, this.z, PalletWorker.R]; }
}
