// Teddy Richter kauft ein – Web-Version. Spielablauf wie game/app.py:
// Menü → Schwierigkeit → Einkaufszettel → Countdown → Einkauf → Kassenbon → Bestenliste der Woche.
import * as THREE from 'three';
import { Market, softShadowTexture, sparkTexture, tex } from './scene.js';
import { Player, Customer, PalletWorker, boxContains, boxNearest } from './actors.js';
import { Sounds } from './sound.js';
import { checkName } from './names.js';
import * as api from './api.js';
import { IMPRESSUM_URL } from './config.js';

const $ = id => document.getElementById(id);
const CAM_DIST = 26;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
if (IMPRESSUM_URL) $('link-impressum').href = IMPRESSUM_URL; else $('impressum-wrap').classList.add('hidden');

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fmtTime = t => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Three.js ----------
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
$('game').appendChild(renderer.domElement);
const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(235 / 255, 233 / 255, 228 / 255);
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 2, 160);   // enger Tiefenbereich = kein Flimmern
let camDist = CAM_DIST;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  // Querformat: 53° breit wie am PC; Hochformat (Handy): etwas breiter und näher dran
  const hfov = aspect >= 1 ? 53 : 62;
  camDist = aspect >= 1 ? CAM_DIST : 17;
  camera.fov = 2 * Math.atan(Math.tan(hfov * Math.PI / 360) / aspect) * 180 / Math.PI;
  camera.fov = Math.min(camera.fov, 80);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Spielzustand ----------
const snd = new Sounds();
const G = {
  state: 'loading', diff: 1, camT: [0, 0], menuT: 0, time: 0,
  items: [], counts: {}, wrong: [], dups: [], log: [], sale: null, saleAt: 99, saleLeft: 0, saleHit: null,
  run: null, flights: [], fx: [], cooldown: 0, current: null, currentZone: null,
};
let LAY, DEPT, SCENE, market, actorsRoot, player = null, customers = [], worker = null, rng = mulberry(Date.now());
let shadowTex, sparkTex;
const iconTex = key => tex(`img/icons/${key}.png`);

function placeCamera(x, z, smooth = 1) {
  G.camT[0] += (x - G.camT[0]) * smooth;
  G.camT[1] += (z - G.camT[1]) * smooth;
  const p = LAY.camPitch * Math.PI / 180;
  const [tx, tz] = G.camT;
  camera.position.set(tx, camDist * Math.sin(p), -(tz - camDist * Math.cos(p)));
  camera.lookAt(tx, 0, -tz);
}

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

function newMarketActors() {
  if (actorsRoot) scene3d.remove(actorsRoot);
  actorsRoot = new THREE.Group();
  scene3d.add(actorsRoot);
  player = null;
  customers = [];
  const n = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    customers.push(new Customer(actorsRoot, LAY, rng, SCENE.actors.customers[i % SCENE.actors.customers.length],
      SCENE.actors.cart, shadowTex));
  }
  worker = new PalletWorker(actorsRoot, LAY, rng, SCENE.actors.pallet, shadowTex);
  // Pfützen jede Runde neu
  const spots = [...LAY.puddleSpots].sort(() => rng() - 0.5);
  G.puddles = spots.slice(0, 2 + Math.floor(rng() * 2));
  market.setPuddles(G.puddles);
}

// ---------- Einkaufszettel ----------
function listHtml(big) {
  const rows = G.items.map(k => {
    const c = G.counts[k] || 0;
    return `<li class="${c ? 'done' : ''}"><span class="box"></span><img src="img/icons/${k}.png" alt="">`
      + `<span class="name">${esc(DEPT[k].name)}</span>${c > 1 ? `<span class="count">${c}×</span>` : ''}</li>`;
  }).join('');
  const wrong = G.wrong.length
    ? `<li class="wrong-head">Nicht auf dem Zettel:</li>` + G.wrong.map(k =>
      `<li class="wrong"><span>✗</span><img src="img/icons/${k}.png" alt=""><span>${esc(DEPT[k].name)}</span></li>`).join('')
    : '';
  const done = G.items.filter(k => G.counts[k]).length;
  return `<div class="paper${big ? ' big' : ''}"><div class="head">EINKAUFSZETTEL</div><ul>${rows}${wrong}</ul>`
    + `<div class="foot">${done}/${G.items.length}</div></div>`;
}
const refreshList = () => { $('list-panel').innerHTML = listHtml(false); };

// ---------- Menü ----------
function showMenu() {
  G.state = 'menu';
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  if (player) { player.dispose(); player = null; }
  show('screen-menu');
}

function showSetup() {
  G.state = 'setup';
  const box = $('diff-buttons');
  box.innerHTML = '';
  LAY.difficulties.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'btn diff' + (i === G.diff ? ' on' : '');
    b.textContent = `${d.label} (${d.n})`;
    b.onclick = () => { G.diff = i; snd.play('click'); showSetup(); };
    box.appendChild(b);
  });
  $('setup-error').classList.add('hidden');
  show('screen-setup');
}

// Zettel würfeln: online würfelt der Server (dann kann niemand schummeln), sonst das Gerät selbst
function localItems(n) {
  const placed = [...new Set(LAY.sections.map(s => s.dept))];
  const drink = LAY.drinkMarket[Math.floor(rng() * LAY.drinkMarket.length)];
  const rest = placed.filter(k => k !== drink).sort(() => rng() - 0.5).slice(0, n - 1);
  const items = [drink, ...rest];
  const saleOpts = placed.filter(k => !items.includes(k));
  return { items, sale_key: saleOpts[Math.floor(rng() * saleOpts.length)], sale_at: 12 + rng() * 16 };
}

async function showList() {
  const diff = LAY.difficulties[G.diff];
  $('btn-go').disabled = true;
  let plan;
  G.run = null;
  if (api.online) {
    try {
      plan = await api.startRun(diff.key);
      G.run = plan.run_id;
    } catch (e) {
      console.warn('Bestenliste nicht erreichbar:', e);
      plan = null;
    }
  }
  if (!plan) plan = localItems(diff.n);
  $('btn-go').disabled = false;
  G.onlineRun = Boolean(G.run);
  const order = k => (DEPT[k].kind === 'produce' ? 0 : 1);
  G.items = [...plan.items].sort((a, b) => order(a) - order(b));
  G.counts = {}; G.wrong = []; G.dups = []; G.log = [];
  G.sale = plan.sale_key; G.saleAt = plan.sale_at; G.saleLeft = 0; G.saleHit = null; G.saleShown = false;
  newMarketActors();
  player = new Player(actorsRoot, LAY.start, LAY.startHeading * Math.PI / 180, SCENE.actors, shadowTex);
  placeCamera(LAY.start[0], LAY.start[1] + 1);
  $('list-big').innerHTML = listHtml(true);
  G.state = 'list';
  show('screen-list');
}

function startCountdown() {
  if (G.state !== 'list') return;
  G.state = 'countdown';
  show('screen-countdown');
  refreshList();
  $('hud').classList.remove('hidden');
  $('timer').textContent = '00:00.0';
  $('banner').classList.add('hidden');
  $('prompt').classList.add('hidden');
  if (G.run) api.goRun(G.run).catch(e => console.warn(e));
  const big = $('count');
  ['3', '2', '1', 'LOS!'].forEach((label, i) => setTimeout(() => {
    if (G.state !== 'countdown') return;
    big.textContent = label;
    big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop');
    snd.play(label === 'LOS!' ? 'go' : 'count');
  }, 800 * i));
  setTimeout(() => {
    if (G.state !== 'countdown') return;
    show(null);
    G.state = 'play';
    G.time = 0; G.cooldown = 0; G.squeak = 0; G.ambient = 5; G.dust = 0;
    if (isTouch) $('touch').classList.remove('hidden');
  }, 3200);
}

// ---------- Eingabe ----------
const keys = new Set();
window.addEventListener('keydown', e => {
  snd.unlock();
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') $('btn-save').click(); return; }
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (k === 'm') toggleMute();
  if (k === 'escape') { if (G.state === 'play' || G.state === 'pause') togglePause(); else if (G.state === 'setup') showMenu(); }
  if (k === 'enter') {
    if (G.state === 'menu') showSetup();
    else if (G.state === 'setup') $('btn-go').click();
    else if (G.state === 'list') startCountdown();
    else if (G.state === 'scores') playAgain();
  }
  if (k === ' ') { if (G.state === 'list') startCountdown(); else if (G.state === 'play') throwItem(); }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') togglePause(); });
document.addEventListener('pointerdown', () => snd.unlock(), { capture: true });

// Joystick am Handy
const stick = { id: null, x: 0, z: 0 };
const knob = $('stick-knob');
function stickMove(e) {
  const r = $('stick').getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2, d = Math.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const dead = 0.18, m = Math.min(1, d / max);   // kleiner Totbereich in der Mitte
  stick.x = m < dead ? 0 : (dx / (d || 1)) * ((m - dead) / (1 - dead));
  stick.z = m < dead ? 0 : (-dy / (d || 1)) * ((m - dead) / (1 - dead));
}
$('stick').addEventListener('pointerdown', e => { stick.id = e.pointerId; $('stick').setPointerCapture(e.pointerId); stickMove(e); });
$('stick').addEventListener('pointermove', e => { if (e.pointerId === stick.id) stickMove(e); });
const stickEnd = e => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.z = 0; knob.style.transform = ''; };
$('stick').addEventListener('pointerup', stickEnd);
$('stick').addEventListener('pointercancel', stickEnd);
$('btn-throw').addEventListener('pointerdown', e => { e.preventDefault(); if (G.state === 'play') throwItem(); });

function toggleMute() {
  const m = snd.toggle();
  $('btn-mute').textContent = m ? '🔇' : '🔊';
}
$('btn-mute').textContent = snd.muted ? '🔇' : '🔊';
$('btn-mute').onclick = toggleMute;
$('btn-pause').onclick = () => togglePause();

function togglePause() {
  if (G.state === 'play') { G.state = 'pause'; keys.clear(); show('screen-pause'); }
  else if (G.state === 'pause') { G.state = 'play'; show(null); }
}

// ---------- Einwerfen ----------
function throwItem() {
  const sec = G.current;
  if (!sec || G.cooldown > 0) return;
  G.cooldown = 0.35;
  const k = sec.dept;
  G.log.push([k, Math.round(G.time * 100) / 100]);
  G.counts[k] = (G.counts[k] || 0) + 1;
  let good = true;
  if (G.items.includes(k)) {
    if (G.counts[k] > 1) { G.dups.push(k); good = false; }
  } else if (G.sale === k && G.saleLeft > 0 && !G.saleHit) {
    G.saleHit = k; G.saleLeft = 0;
    banner(`Angebot geschnappt: -${LAY.saleBonus} Sekunden!`);
    setTimeout(() => { if (G.state === 'play') banner(''); }, 2500);
  } else { G.wrong.push(k); good = false; }
  refreshList();
  snd.play('throw', 0.8);
  const [sx, sz] = boxNearest(sec.body, player.x, player.z);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex(k) }));
  sp.scale.setScalar(0.9);
  sp.position.set(sx, 1.3, -sz);
  scene3d.add(sp);
  G.flights.push({ sp, t: 0, start: [sx, 1.3, sz], dept: k, good });
}

function updateFlights(dt) {
  for (const f of [...G.flights]) {
    f.t += dt / 0.45;
    const t = Math.min(1, f.t);
    const [ex, ey, ez] = player.worldCartPoint();
    const [sx, sy, sz] = f.start;
    f.sp.position.set(sx + (ex - sx) * t, sy + (ey - sy) * t + Math.sin(t * Math.PI) * 1.6, -(sz + (ez - sz) * t));
    f.sp.scale.setScalar(0.9 - 0.4 * t);
    if (t >= 1) {
      scene3d.remove(f.sp);
      G.flights.splice(G.flights.indexOf(f), 1);
      const c = DEPT[f.dept].color;
      player.addItem(new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255), iconTex(f.dept));
      burst(player.worldCartPoint(), f.good);
      snd.play('land', 0.8);
      snd.play(f.good ? 'ok' : 'wrong', 0.6);
    }
  }
}

// ---------- Effekte ----------
function spark(pos, col, v, life, size, grow, grav) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: col, transparent: true, depthWrite: false }));
  sp.position.set(pos[0], pos[1], -pos[2]);
  sp.scale.setScalar(size);
  scene3d.add(sp);
  G.fx.push({ sp, v: [...v], life, t: 0, grow, grav, size });
}
function burst(pos, good) {
  const cols = good ? [0xffd73c, 0x50c85a, 0xffffff] : [0xe62832, 0xff7878];
  for (let i = 0; i < (good ? 16 : 10); i++) {
    const a = rng() * Math.PI * 2, sp = 1.5 + rng() * 1.7;
    spark(pos, cols[Math.floor(rng() * cols.length)], [Math.cos(a) * sp, 2.5 + rng() * 2, Math.sin(a) * sp],
      0.5 + rng() * 0.3, 0.18 + rng() * 0.12, 0, 9);
  }
}
function dust(p, wet) {
  const s = Math.sin(p.heading), c = Math.cos(p.heading);
  for (const side of [-0.3, 0.3]) {
    spark([p.x + c * side + s * 1.1, 0.15, p.z - s * side + c * 1.1], wet ? 0x78beff : 0xd7d2c8,
      [rng() * 0.8 - 0.4, 0.6 + rng() * 0.6, rng() * 0.8 - 0.4], 0.5, 0.35, 1.6, 0);
  }
}
function updateFx(dt) {
  for (const f of [...G.fx]) {
    f.t += dt;
    f.v[1] -= f.grav * dt;
    f.sp.position.x += f.v[0] * dt; f.sp.position.y += f.v[1] * dt; f.sp.position.z -= f.v[2] * dt;
    f.size *= 1 + f.grow * dt;
    f.sp.scale.setScalar(f.size);
    const k = f.t / f.life;
    f.sp.material.opacity = Math.max(0, 1 - k);
    if (k >= 1) { scene3d.remove(f.sp); G.fx.splice(G.fx.indexOf(f), 1); }
  }
}
function clearFx() {
  for (const f of G.fx) scene3d.remove(f.sp);
  for (const f of G.flights) scene3d.remove(f.sp);
  G.fx = []; G.flights = [];
}

function banner(text) { $('banner').textContent = text; $('banner').classList.toggle('hidden', !text); }
function prompt(text) { $('prompt').textContent = text; $('prompt').classList.toggle('hidden', !text); }

// ---------- Spielschleife ----------
function updateNpcs(dt, ghost) {
  const far = { x: -1000, z: -1000 };
  const pl = ghost || !player ? far : player;
  for (const c of customers) c.update(dt, pl, customers, [worker.obstacle]);
  worker.update(dt, pl);
}

function updatePlay(dt) {
  G.time += dt; G.cooldown -= dt; G.squeak -= dt; G.ambient -= dt; G.dust -= dt;
  const p = player;
  let ix = 0, iz = 0;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('w') || keys.has('arrowup')) iz += 1;
  if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
  if (ix && iz) { ix *= 0.7071; iz *= 0.7071; }
  if (stick.id !== null) { ix = stick.x; iz = stick.z; }
  const wet = G.puddles.some(([px, pz]) => Math.hypot(p.x - px, p.z - pz) < 1.6);
  const circles = customers.map(c => c.circle).concat(LAY.cashiers.map(([x, z]) => [x, z, 0.35]));
  let boxes = LAY.obstacles;
  const ob = worker.obstacle;
  if (ob.length === 5) boxes = boxes.concat([ob]); else circles.push(ob);
  const impact = p.update(dt, ix, iz, wet, boxes, circles, LAY.walls);
  if (impact > 1.5) snd.play('bump', Math.min(1, impact / 7));
  if (p.speed > 4 && p.slipAngle() > 0.45 && G.squeak <= 0) { snd.play('squeak', 0.7); G.squeak = 0.7; }
  if (G.ambient <= 0) { snd.play('ambient', 0.5); G.ambient = 4 + rng() * 5; }
  updateNpcs(dt, false);
  updateFlights(dt);
  updateFx(dt);
  if (p.speed > 3.5 && (p.slipAngle() > 0.35 || wet) && G.dust <= 0) { G.dust = 0.04; dust(p, wet); }

  // Angebots-Durchsage
  if (!G.saleShown && G.sale && G.time > G.saleAt) {
    G.saleShown = true; G.saleLeft = LAY.saleWindow; snd.play('gong', 0.9);
  }
  if (G.saleLeft > 0) {
    G.saleLeft -= dt;
    banner(`DURCHSAGE: ${DEPT[G.sale].name} im Angebot! Einwerfen = -${LAY.saleBonus} s (${Math.ceil(G.saleLeft)})`);
    if (G.saleLeft <= 0) banner('');
  }

  // Abteilung in Reichweite?
  let best = null, bestZone = null, bestD = 99;
  for (const sec of LAY.sections) {
    for (const z of sec.zones) {
      if (boxContains(z, p.x, p.z)) {
        const [nx, nz] = boxNearest(sec.body, p.x, p.z);
        const d = Math.hypot(p.x - nx, p.z - nz);
        if (d < bestD) { best = sec; bestZone = z; bestD = d; }
      }
    }
  }
  if (best !== G.current) {
    G.current = best;
    const name = best ? DEPT[best.dept].name : '';
    prompt(best ? (isTouch ? `${name} einwerfen` : `LEERTASTE: ${name} einwerfen`) : '');
    const btn = $('btn-throw'), icon = $('throw-icon');
    btn.classList.toggle('ready', Boolean(best));
    if (best) icon.src = `img/icons/${best.dept}.png`; else icon.removeAttribute('src');
  }
  market.showHighlight(bestZone, G.time);
  placeCamera(p.x, p.z + 1.0, 1 - Math.exp(-6 * dt));
  market.fadeRows(p.x, p.z);
  $('timer').textContent = fmtTime(G.time);

  // durch eine Kassengasse nach rechts Richtung Ausgang = bezahlen
  for (const lane of LAY.lanes) {
    if (boxContains(lane, p.x, p.z) && p.x > lane[0] && p.vx > 0.3) { finish(); break; }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.state === 'menu' || G.state === 'setup' || G.state === 'scores') {
    G.menuT += dt;
    placeCamera(LAY.width * 0.45 + Math.sin(G.menuT * 0.12) * LAY.width * 0.3,
      LAY.depth * 0.5 + Math.cos(G.menuT * 0.09) * 9, 1);
    updateNpcs(dt, true);
  } else if (G.state === 'countdown') {
    updateNpcs(dt, false);
  } else if (G.state === 'play') {
    updatePlay(dt);
  }
  renderer.render(scene3d, camera);
  requestAnimationFrame(frame);
}

// ---------- Kasse ----------
function evaluate() {
  const correct = G.items.filter(k => G.counts[k]).length;
  const missing = G.items.length - correct;
  const nBad = missing + G.dups.length + G.wrong.length;
  const bonus = G.saleHit ? LAY.saleBonus : 0;
  const penalty = LAY.penalty * nBad;
  return { correct, penalty, bonus, time: G.time, final: G.time + penalty - bonus };
}

function receiptHtml(r) {
  const P = LAY.penalty;
  const line = (sym, cls, text, amt) =>
    `<div class="line ${cls}"><span class="sym">${sym}</span><span>${esc(text)}</span><span class="amt">${amt}</span></div>`;
  let h = `<img src="img/logo.png" class="logo" alt="REWE Richter">`
    + `<div class="title">TEDDY RICHTER KAUFT EIN · ${esc(LAY.difficulties[G.diff].label.toUpperCase())}</div><hr>`;
  for (const k of G.items) {
    h += G.counts[k] ? line('✓', 'good', DEPT[k].name, '') : line('✗', 'bad', `${DEPT[k].name} (fehlt)`, `+${P} s`);
  }
  for (const k of G.dups) h += line('✗', 'bad', `${DEPT[k].name} (doppelt)`, `+${P} s`);
  for (const k of G.wrong) h += line('✗', 'bad', `${DEPT[k].name} (falsch)`, `+${P} s`);
  if (G.saleHit) h += line('★', 'good', `${DEPT[G.saleHit].name} (Angebot)`, `-${LAY.saleBonus} s`);
  h += '<hr>' + line('', '', 'Fahrzeit', fmtTime(r.time)) + line('', '', 'Strafzeit', `+${r.penalty} s`);
  if (r.bonus) h += line('', '', 'Angebot', `-${r.bonus} s`);
  h += line('', '', 'Richtig', `${r.correct} von ${G.items.length}`);
  h += `<div class="total"><span>ENDZEIT</span><span>${fmtTime(r.final)}</span></div>`;
  return h;
}

async function finish() {
  G.state = 'receipt';
  market.showHighlight(null);
  clearFx();
  prompt(''); banner('');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  snd.play('beep');
  setTimeout(() => snd.play('beep'), 250);
  setTimeout(() => snd.play('kaching'), 600);
  const r = evaluate();
  G.result = r;
  $('receipt').innerHTML = receiptHtml(r);
  $('final-time').textContent = `Endzeit: ${fmtTime(r.final)}`;
  $('name-error').classList.add('hidden');
  $('name-box').classList.add('hidden');
  $('btn-save').disabled = false;
  try { $('name-input').value = localStorage.getItem('teddy-name') || ''; } catch { /* egal */ }
  show('screen-receipt');
  if (G.onlineRun) {
    $('check-state').textContent = 'Zeit wird geprüft …';
    try {
      const res = await api.finishRun(G.run, G.log, Math.round(G.time * 100) / 100);
      if (res.valid) {
        $('check-state').textContent = 'Zeit geprüft ✓';
        if (Math.abs(res.final - r.final) > 0.05) $('final-time').textContent = `Endzeit: ${fmtTime(res.final)}`;
        $('name-box').classList.remove('hidden');
      } else {
        $('check-state').textContent = `Diese Runde kann leider nicht gewertet werden (${res.reason}).`;
      }
    } catch (e) {
      $('check-state').textContent = 'Bestenliste gerade nicht erreichbar – die Runde zählt leider nicht.';
      console.warn(e);
    }
  } else {
    $('check-state').textContent = api.online ? 'Ohne Verbindung gespielt: Eintrag nur auf diesem Gerät.' : '';
    $('name-box').classList.remove('hidden');
  }
}

$('btn-save').onclick = async () => {
  const chk = checkName($('name-input').value);
  const err = $('name-error');
  if (!chk.ok) { err.textContent = chk.msg; err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  try { localStorage.setItem('teddy-name', chk.name); } catch { /* egal */ }
  const diffKey = LAY.difficulties[G.diff].key;
  if (G.onlineRun) {
    $('btn-save').disabled = true;
    try {
      const res = await api.saveName(G.run, chk.name);
      if (!res.ok) { err.textContent = res.error || 'Name nicht erlaubt.'; err.classList.remove('hidden'); $('btn-save').disabled = false; return; }
      G.myRank = { diff: G.diff, index: (res.rank || 1) - 1 };
      showScores(G.diff);
    } catch (e) {
      err.textContent = 'Speichern hat nicht geklappt. Bitte nochmal versuchen.';
      err.classList.remove('hidden');
      $('btn-save').disabled = false;
    }
  } else {
    const entry = { name: chk.name, final: Math.round(G.result.final * 10) / 10, correct: G.result.correct, total: G.items.length, me: Date.now() };
    api.localSave(diffKey, entry);
    G.myLocal = entry.me;
    showScores(G.diff);
  }
};
$('btn-skip').onclick = () => showScores(G.diff);

// ---------- Bestenliste ----------
async function showScores(diffIndex) {
  snd.play('click');
  G.state = 'scores';
  G.scoreDiff = diffIndex;
  if (player) { player.dispose(); player = null; }
  const tabs = $('score-tabs');
  tabs.innerHTML = '';
  LAY.difficulties.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'btn diff' + (i === diffIndex ? ' on' : '');
    b.textContent = d.label;
    b.onclick = () => showScores(i);
    tabs.appendChild(b);
  });
  show('screen-scores');
  const table = $('score-table');
  table.innerHTML = '<p class="empty">Lade …</p>';
  const key = LAY.difficulties[diffIndex].key;
  let rows = [], weekEnd = new Date(api.weekStart().getTime() + 7 * 864e5);
  if (api.online) {
    try {
      const res = await api.leaderboard(key);
      rows = (res.rows || []).map((r, i) => ({ ...r, isMe: G.myRank && G.myRank.diff === diffIndex && G.myRank.index === i }));
      if (res.week_end) weekEnd = new Date(res.week_end);
    } catch (e) {
      table.innerHTML = '<p class="empty">Bestenliste gerade nicht erreichbar.</p>';
      return;
    }
  } else {
    rows = api.localBoard(key).rows.map(r => ({ ...r, isMe: r.me === G.myLocal }));
  }
  if (G.state !== 'scores' || G.scoreDiff !== diffIndex) return;
  table.innerHTML = rows.length
    ? '<table>' + rows.map((r, i) => `<tr class="${r.isMe ? 'me' : ''}"><td class="rank">${i + 1}.</td>`
      + `<td class="name">${esc(r.name)}</td><td class="ok">${r.correct}/${r.total}</td>`
      + `<td class="time">${fmtTime(r.final)}</td></tr>`).join('') + '</table>'
    : '<p class="empty">Noch keine Einträge diese Woche – sei die/der Erste!</p>';
  const ms = weekEnd - Date.now(), dd = Math.floor(ms / 864e5), hh = Math.floor(ms % 864e5 / 36e5);
  $('week-info').textContent = (api.online ? '' : 'Nur auf diesem Gerät gespeichert. ')
    + `Neue Woche (Sonntag 20 Uhr) in ${dd > 0 ? `${dd} Tag${dd > 1 ? 'en' : ''} und ` : ''}${hh} Std.`;
}

function playAgain() { snd.play('click'); showSetup(); }

// ---------- Knöpfe ----------
for (const b of document.querySelectorAll('[data-go]')) {
  b.addEventListener('click', () => {
    snd.unlock(); snd.play('click');
    const t = b.dataset.go;
    if (t === 'setup') showSetup(); else if (t === 'scores') showScores(G.diff); else showMenu();
  });
}
$('btn-go').onclick = () => { snd.play('click'); showList(); };
$('btn-start').onclick = () => startCountdown();
$('btn-resume').onclick = () => togglePause();
$('btn-quit').onclick = () => { clearFx(); showMenu(); };
$('btn-again').onclick = playAgain;

// ---------- Laden ----------
async function load() {
  const [lay, sc] = await Promise.all([
    fetch('data/markt.json').then(r => r.json()),
    fetch('data/szene.json').then(r => r.json()),
  ]);
  LAY = lay; SCENE = sc;
  DEPT = Object.fromEntries(lay.depts.map(d => [d.key, d]));
  shadowTex = softShadowTexture();
  sparkTex = sparkTexture();
  market = new Market(scene3d, sc, lay);
  newMarketActors();
  showMenu();
  requestAnimationFrame(frame);
}
load().catch(e => {
  $('loading-text').textContent = 'Das Spiel konnte nicht geladen werden. Bitte Seite neu laden.';
  console.error(e);
});

// Nur zum Testen: mit ?debug in der Adresse erreichbar
if (new URLSearchParams(location.search).has('debug')) {
  window.T = { G, LAY: () => LAY, get player() { return player; }, throwItem, finish, placeCamera };
}
