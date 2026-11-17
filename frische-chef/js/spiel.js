// Frische-Chef: Obst & Gemüse. Zeitmanagement-Spiel in der echten O&G-Abteilung des REWE Richter.
// Ablauf je Auftrag: Palette (Lager) -> Sortiertisch -> richtiges Fach (Kühlung / Raumtemperatur) -> Leergut zur Presse.
import { Raster, boxDist } from './raster.js';
import { Welt } from './welt3d.js';
import { Musik } from './musik.js';
import { Sounds } from '../../shared/js/sound.js';
import * as fortschritt from '../../shared/js/fortschritt.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const BOT = Q.has('bot'), FAST = Number(Q.get('fast')) || 1, BOT_DENK = Q.get('bot') === 'mensch' ? 0.8 : 0;

const RUNDE = 120, FINALE = 30;
// Erstmal spielt man nur Teddy (Wunsch des Inhabers). Der Azubi als zweite Figur ist vorbereitet: MIT_AZUBI = true.
const MIT_AZUBI = false;
const FIG = {
  teddy: { name: 'Teddy', speed: 5.0, sort: 1.1, shelve: 0.8, fifo: 0.5, pick: 0.35, fold: 0.4, cap: MIT_AZUBI ? 1 : 3, sees: true },
  azubi: { name: 'Azubi', speed: 6.0, sort: 2.2, shelve: 1.6, fifo: 1.0, pick: 0.25, fold: 0.3, cap: 3, sees: false },
};
const DASH = { mult: 1.8, dur: 1.2, cool: 5 };
const STERNE = MIT_AZUBI ? [500, 1200, 2000] : [600, 1400, 2200];       // Punkte für 1 / 2 / 3 Sterne (3 Sterne nur mit höchstens 2 leeren Fächern)
const MAX_AUFTRAEGE = 4;

const snd = new Sounds();
const musik = new Musik();
const vib = ms => { if (BOT) return; try { navigator.vibrate && navigator.vibrate(ms); } catch { /* egal */ } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

let OG, R, ST = [], WST = {}, ICON = {};
let G = null;

// ---------- Laden ----------
async function load() {
  OG = await fetch('data/og.json').then(r => r.json());
  R = new Raster(OG);
  ST = OG.stationen.map(s => ({ ...s, stock: 3 }));
  for (const s of ST) {
    s.cells = R.zoneCells(s);
    s.cellSet = new Set(s.cells);
    if (s.typ === 'regal') (WST[s.ware] ||= []).push(s);
  }
  await Promise.all(Object.keys(OG.ware).map(k => new Promise(res => {
    const im = new Image(); im.onload = res; im.onerror = res; im.src = `../shared/img/icons/${k}.png`; ICON[k] = im;
  })));
  const best = fortschritt.spiel('frische-chef');
  if (typeof best.best === 'number') $('start-best').textContent = `Dein Rekord: ${best.best.toLocaleString('de-DE')} Punkte · ${best.sterne || 0} ★`;
  const szene = await fetch('../einkauf/data/szene.json').then(r => r.json());
  WELT = new Welt(cv, OG, szene);
  resize();
  $('btn-go').disabled = false; $('btn-go').textContent = "Los geht's!";
  requestAnimationFrame(frame);
  if (BOT) startRound(true);
}
const station = id => ST.find(s => s.id === id);

// ---------- Runde ----------
function newState() {
  for (const s of ST) s.stock = 3;
  const f = (key, [x, y]) => ({ key, ...FIG[key], x, y, path: [], target: null, work: null, hold: null, wait: 0, dashT: 0, dir: 0, step: 0 });
  return {
    t: 0, running: false, paused: false, over: false, score: 0, combo: 0, maxCombo: 0, finale: false,
    orders: [], palette: [], leergut: [], kunden: [], floats: [], id: 1,
    fig: MIT_AZUBI ? { teddy: f('teddy', OG.start.teddy), azubi: f('azubi', OG.start.azubi) } : { teddy: f('teddy', OG.start.teddy) },
    active: 'teddy',
    nextOrder: 1.0, nextKunde: 3, dashCool: 0, toastT: 0, joy: null,
    retoureTisch: 0,         // aussortierte faule Ware am Sortiertisch, muss ins Kühlhaus
    stats: { erledigt: 0, leer: 0, falsch: 0, faul: 0, aussortiert: 0, retoure: 0, leergut: 0 },
  };
}

function startRound(skipCount = false) {
  G = newState();
  if (WELT) WELT.reset();
  ['s-start', 's-end', 's-pause'].forEach(id => $(id).classList.add('hidden'));
  renderOrders(); updateHud(); updateBar();
  if (skipCount) { go(); return; }
  const el = $('s-count'); el.classList.remove('hidden');
  let n = 3; $('count').textContent = n; snd.play('count');
  const iv = setInterval(() => {
    n--;
    if (n > 0) { $('count').textContent = n; snd.play('count'); } else { clearInterval(iv); el.classList.add('hidden'); go(); }
  }, 700);
}
function go() {
  G.running = true; snd.play('go');
  musik.finale = false; musik.druck = 0; musik.start(snd.ctx);
  toast('Los! Tipp auf einen Auftrag oder die Palette im Lager.');
}

function endRound() {
  G.running = false; G.over = true;
  musik.stop();
  snd.play('gong');
  const s = G.score, st = G.stats;
  let sterne = STERNE.filter(v => s >= v).length;
  if (sterne === 3 && st.leer > 2) sterne = 2;
  const res = fortschritt.melden('frische-chef', { sterne, punkte: s });
  $('end-title').textContent = sterne === 3 ? 'Frische-Chef!' : sterne ? 'Feierabend!' : 'Puh, geschafft!';
  const STAR = '<svg class="sw-star{on}" style="animation-delay:{d}s" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  $('end-stars').innerHTML = [1, 2, 3].map(i => STAR.replace('{on}', i <= sterne ? ' on' : '').replace('{d}', (0.25 + i * 0.25).toFixed(2))).join('');
  $('end-points').textContent = `${s.toLocaleString('de-DE')} Punkte`;
  $('end-record').classList.toggle('hidden', !res.neuerRekord || s === 0);
  const rows = [['Aufträge erledigt', st.erledigt], ['Längste Combo', `×${comboMult(G.maxCombo).toLocaleString('de-DE')}`],
    ['Faule Ware aussortiert', st.aussortiert], ['Retoure ins Kühlhaus', st.retoure], ['Leergut weggebracht', st.leergut],
    ['Leere Fächer', st.leer], ['Falsch eingeräumt', st.falsch + st.faul]];
  $('end-stats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  $('s-end').classList.remove('hidden');
  if (sterne) setTimeout(() => snd.play('kaching'), 500);
  vib([30, 60, 30]);
}

// ---------- Aufträge ----------
const comboMult = c => 1 + 0.5 * Math.min(c, 4);
function spawnOrder() {
  const open = new Set(G.orders.map(o => o.ware));
  const held = new Set(Object.values(G.fig).filter(f => f.hold && f.hold.typ === 'kiste').map(f => f.hold.ware));
  const cand = Object.keys(WST).filter(w => !open.has(w) && !held.has(w));
  if (!cand.length) return;
  const ware = pick(cand);
  const life = MIT_AZUBI ? lerp(50, 34, G.t / RUNDE) : lerp(56, 42, G.t / RUNDE);
  const o = { id: G.id++, ware, t: 0, life };
  G.orders.push(o);
  for (const s of WST[ware]) s.stock = 0;
  G.palette.push({ id: G.id++, typ: 'kiste', ware, orderId: o.id, bad: G.stats.erledigt + G.stats.leer >= 2 && Math.random() < 0.3, state: 'roh' });
  snd.play('click', 0.6);
  renderOrders();
}
function removeOrder(o, cls) {
  G.orders = G.orders.filter(x => x !== o);
  const el = document.querySelector(`.order[data-id="${o.id}"]`);
  if (el) { el.classList.add(cls); setTimeout(renderOrders, 330); } else renderOrders();
}
function updateOrders(dt) {
  for (const o of [...G.orders]) {
    o.t += dt;
    if (o.t >= o.life) {
      G.stats.leer++; G.combo = 0; addScore(-20);
      G.palette = G.palette.filter(c => c.orderId !== o.id);
      for (const s of WST[o.ware]) s.stock = 1;          // Kollegen füllen notdürftig nach
      toast(`Fach leer: ${OG.ware[o.ware].name}! −20`, 'bad'); snd.play('wrong'); vib(80);
      removeOrder(o, 'gone');
    }
  }
}
function renderOrders() {
  const box = $('orders');
  let h = '';
  for (let i = 0; i < MAX_AUFTRAEGE; i++) {
    const o = G && G.orders[i];
    if (!o) { h += '<div class="order empty"></div>'; continue; }
    const w = OG.ware[o.ware], k = w.temp === 'kuehl';
    h += `<button class="order" data-id="${o.id}" aria-label="${w.name} nachfüllen"><span class="temp ${k ? 'k' : 'r'}">${k ? '❄' : '☀'}</span>`
      + `<img src="../shared/img/icons/${o.ware}.png" alt=""><b>${w.name}</b><span class="bar"></span></button>`;
  }
  box.innerHTML = h;
  updateOrderBars();
}
function updateOrderBars() {
  if (!G) return;
  for (const o of G.orders) {
    const el = document.querySelector(`.order[data-id="${o.id}"]`);
    if (!el) continue;
    const rest = 1 - o.t / o.life;
    el.querySelector('.bar').style.width = `${rest * 100}%`;
    el.classList.toggle('y', rest < 0.55 && rest >= 0.25);
    el.classList.toggle('r', rest < 0.25);
    const f = G.fig[G.active];
    el.classList.toggle('target', !!(f.target && f.target.order === o));
  }
}
$('orders').addEventListener('click', e => {
  const el = e.target.closest('.order[data-id]');
  if (!el || !G || !G.running || G.paused) return;
  const o = G.orders.find(x => x.id === Number(el.dataset.id));
  if (!o) return;
  snd.unlock(); vib(10);
  const f = G.fig[G.active];
  if (f.hold) {
    // Hand voll: dann direkt zum passenden Ort für das, was die Figur trägt
    toast(f.hold.typ === 'leer' ? 'Erst das Leergut zur Presse!' : 'Hände voll – erst diese Kiste wegbringen.', 'bad');
    return;
  }
  if (!G.palette.some(c => c.orderId === o.id)) { toast('Diese Kiste ist schon unterwegs.'); return; }
  command(f, { st: station('palette'), order: o });
});

// ---------- Punkte, Hinweise ----------
function addScore(v, x, y, text) {
  G.score = Math.max(0, G.score + v);
  if (x != null) G.floats.push({ x, y, text: text || (v > 0 ? `+${v}` : `${v}`), t: 0, good: v >= 0 });
  updateHud();
}
let toastTimer = 0;
function toast(text, cls = '') {
  const el = $('toast');
  el.textContent = text; el.className = cls;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), cls === 'ot' ? 2600 : 2000);
}
function updateHud() {
  if (!G) return;
  $('pts').textContent = G.score.toLocaleString('de-DE');
  const m = comboMult(G.combo), c = $('combo');
  const txt = `×${m.toLocaleString('de-DE')}`;
  if (c.textContent !== txt) { c.textContent = txt; c.classList.add('pop'); setTimeout(() => c.classList.remove('pop'), 160); }
  c.classList.toggle('off', G.combo === 0);
  const rest = Math.max(0, RUNDE - G.t);
  $('clock').textContent = `${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}`;
  $('clock').classList.toggle('ot', G.finale);
}
const holdText = h => !h ? '' : h.typ === 'leer' ? `${h.n}× Leergut` : h.typ === 'retoure' ? `${h.n}× Retoure` : `${OG.ware[h.ware].name}${h.state === 'roh' ? ' (Folie)' : ''}`;
function updateBar() {
  if (!G) return;
  for (const k of Object.keys(G.fig)) {
    $(`who-${k}`).classList.toggle('on', G.active === k);
    $(`hold-${k}`).textContent = holdText(G.fig[k].hold) || (G.fig[k].work ? G.fig[k].work.label : '');
  }
  const d = $('btn-dash');
  d.classList.toggle('cool', G.dashCool > 0);
  $('dash-ring').style.strokeDashoffset = `${107 * (G.dashCool / DASH.cool)}`;
}
function setActive(k) {
  if (!G || !G.fig[k]) return;
  if (!G || G.active === k) return;
  G.active = k; snd.play('click'); vib(12); updateBar(); updateOrderBars();
}

// ---------- Befehle ----------
function command(f, target) {
  if (G.joy && G.joy.fig === f) G.joy = null;
  let goals;
  if (target.st) goals = target.st.cells;
  else if (target.lg) goals = neighbours(target.lg.cell);
  else { const i = R.nearestFree(target.x, target.y); goals = i >= 0 ? [i] : []; }
  const path = R.path(f.x, f.y, goals);
  if (!path) {
    toast(target.st && target.st.cells.some(c => R.dyn[c]) ? 'Leergut versperrt den Weg!' : 'Da komme ich nicht hin.', 'bad');
    snd.play('wrong', 0.5); return;
  }
  f.work = null; f.path = path; f.target = target; f.wait = 0;
  updateBar(); updateOrderBars();
}
function neighbours(cell) {
  const out = [], C = R.cols, c0 = cell % C, r0 = Math.floor(cell / C);
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
    if ((r !== r0 || c !== c0) && c >= 0 && r >= 0 && c < C && r < R.rows) out.push(r * C + c);
  }
  return out;
}
function work(f, dur, label, done) { f.work = { t: 0, dur, label, done }; updateBar(); }
function blocked(st) { return G.leergut.some(l => st.cellSet.has(l.cell)); }

function arrive(f) {
  const tg = f.target; f.target = null;
  if (tg.lg) return pickLeergut(f, tg.lg);
  if (!tg.st) return;
  const st = tg.st, h = f.hold;
  const fx = st.body[0], fy = st.body[1];
  switch (st.typ) {
    case 'palette': {
      if (h) return toast('Hände voll!', 'bad');
      let c = tg.order && G.palette.find(k => k.orderId === tg.order.id);
      if (!c) {
        const byUrg = [...G.orders].sort((a, b) => (b.t / b.life) - (a.t / a.life));
        for (const o of byUrg) { c = G.palette.find(k => k.orderId === o.id); if (c) break; }
      }
      if (!c) c = G.palette[0];
      if (!c) return toast('Noch keine Lieferung da.');
      return work(f, f.pick, 'Kiste nehmen', () => {
        if (!G.palette.includes(c)) return;
        G.palette = G.palette.filter(k => k !== c); f.hold = c; snd.play('click');
      });
    }
    case 'sortier': {
      if (!h || (h.typ === 'retoure' && h.n < f.cap)) {
        if (!G.retoureTisch) return toast(h ? 'Keine Retoure mehr auf dem Tisch.' : 'Erst eine Kiste von der Palette holen.');
        return work(f, 0.35, 'Retoure nehmen', () => {
          const n = Math.min(G.retoureTisch, f.cap - (h ? h.n : 0));
          G.retoureTisch -= n;
          if (f.hold) f.hold.n += n; else f.hold = { typ: 'retoure', n };
          snd.play('click');
        });
      }
      if (h.typ === 'leer') return toast('Leergut gehört zur Ballenpresse.', 'bad');
      if (h.typ === 'retoure') return toast('Retoure ins Kühlhaus – Tür zwischen Sushi und Obst!', 'bad');
      if (h.state === 'bereit') return toast('Schon fertig – ab ins richtige Fach!');
      if (G.retoureTisch >= 3) { snd.play('wrong', 0.5); return toast('Sortiertisch voll: erst die Retoure ins Kühlhaus bringen!', 'bad'); }
      return work(f, f.sort, 'Sortieren', () => {
        h.state = 'bereit'; snd.play('ok', 0.6);
        if (h.bad && f.sees) {
          h.bad = false; G.retoureTisch++; G.stats.aussortiert++;
          addScore(10, fx, fy, 'Aussortiert +10');
          toast('Faule Ware aussortiert – die Retoure kommt ins Kühlhaus.');
        }
      });
    }
    case 'presse': {
      if (!h || h.typ !== 'leer') return toast(h && h.typ === 'retoure' ? 'Retoure gehört ins Kühlhaus, nicht in die Presse!' : 'Hier kommt das Leergut hin.', h ? 'bad' : '');
      return work(f, 0.4, 'Pressen', () => {
        G.stats.leergut += h.n; addScore(5 * h.n, fx, fy - 1.2, `Leergut +${5 * h.n}`);
        f.hold = null; snd.play('land');
      });
    }
    case 'retoure': {
      if (!h || h.typ !== 'retoure') return toast(G.retoureTisch ? 'Erst die Retoure am Sortiertisch abholen.' : 'Hier im Kühlhaus wird die Retoure abgestellt.');
      return work(f, 0.5, 'Abstellen', () => {
        G.stats.retoure += h.n; addScore(15 * h.n, fx, fy, `Retoure +${15 * h.n}`);
        f.hold = null; snd.play('land');
      });
    }
    case 'waage': return;
    case 'regal': {
      if (!h) return;
      if (h.typ === 'leer') return toast('Leergut zur Ballenpresse im Lager!', 'bad');
      if (h.typ === 'retoure') return toast('Retoure ins Kühlhaus – Tür zwischen Sushi und Obst!', 'bad');
      if (h.state === 'roh') { snd.play('wrong', 0.5); return toast('Erst zum Sortiertisch: Folie runter, Preisschild rein!', 'bad'); }
      if (h.ware !== st.ware) {
        const wt = OG.ware[h.ware].temp, stt = OG.ware[st.ware].temp;
        G.stats.falsch++; G.combo = 0; addScore(-20, fx, fy, '−20');
        snd.play('wrong'); vib(80);
        return toast(wt !== stt ? (wt === 'kuehl' ? `${OG.ware[h.ware].name} gehört in die Kühlung!` : `${OG.ware[h.ware].name} braucht keine Kühlung!`)
          : `Falsches Fach – hier liegen ${OG.ware[st.ware].name}.`, 'bad');
      }
      if (blocked(st)) { snd.play('wrong', 0.5); return toast('Leergut steht vor dem Fach – erst wegräumen!', 'bad'); }
      const fifo = st.stock > 0;
      return work(f, f.shelve + (fifo ? f.fifo : 0), fifo ? 'Wälzen (FIFO)' : 'Einräumen', () => shelve(f, st, h));
    }
  }
}

function shelve(f, st, h) {
  for (const s of WST[st.ware]) s.stock = 3;
  f.hold = null;
  const o = G.orders.find(x => x.id === h.orderId) || G.orders.find(x => x.ware === h.ware);
  const [fx, fy] = [st.body[0], st.body[1]];
  if (h.bad) {
    G.stats.faul++; G.combo = 0; addScore(-30, fx, fy, '−30');
    toast('Kunde findet faule Ware! Teddy hätte sie aussortiert.', 'bad'); snd.play('wrong'); vib(90);
    if (o) removeOrder(o, 'gone');
  } else if (o) {
    const rest = 1 - o.t / o.life;
    G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
    const pts = Math.round((50 + 50 * rest) * comboMult(G.combo - 1) * (G.finale ? 2 : 1));
    G.stats.erledigt++; addScore(pts, fx, fy);
    snd.play('kaching', 0.7); vib(25);
    removeOrder(o, 'gone');
  } else {
    addScore(10, fx, fy);
    snd.play('ok');
  }
  dropLeergut(f);
}
function dropLeergut(f) {
  // leere IFCO-Kiste bleibt neben der Figur stehen
  const taken = new Set(G.leergut.map(l => l.cell));
  const fc = R.idx(f.x, f.y);
  let best = -1, bd = 1e9;
  for (const c of [...neighbours(fc), fc]) {
    if (!R.free(c) || taken.has(c)) continue;
    const [x, y] = R.center(c), d = Math.hypot(x - f.x, y - f.y) + (c === fc ? 2 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best < 0) return;
  const [x, y] = R.center(best);
  G.leergut.push({ id: G.id++, cell: best, x, y, t: 0 });
  R.dyn[best] = 1;
}
function pickLeergut(f, lg) {
  if (!G.leergut.includes(lg)) return;
  if (f.hold && (f.hold.typ !== 'leer' || f.hold.n >= f.cap)) {
    return toast(f.hold.typ !== 'leer' ? `${f.name} hat die Hände voll.` : f.cap > 1 ? `Mehr als ${f.cap} Kisten gehen nicht.` : 'Teddy hat die Hände voll. Der Azubi trägt bis zu 3 Kisten!', 'bad');
  }
  work(f, f.fold, 'Zusammenklappen', () => {
    if (!G.leergut.includes(lg)) return;
    G.leergut = G.leergut.filter(l => l !== lg); R.dyn[lg.cell] = 0;
    if (f.hold) f.hold.n++; else f.hold = { typ: 'leer', n: 1 };
    snd.play('click');
  });
}

// ---------- Kunden ----------
const SHIRTS = ['#3a6fb0', '#6a8f3a', '#8a4fa0', '#d07a2a', '#3e9b9b', '#b33b5a', '#555'];
function spawnKunde() {
  const gate = pick(OG.kundenTore);
  const toWaage = Math.random() < 0.3;
  const st = toWaage ? station('waage') : pick(ST.filter(s => s.typ === 'regal'));
  const path = R.path(gate[0], gate[1], st.cells);
  if (!path) return;
  G.kunden.push({ x: gate[0], y: gate[1], path, state: 'gehen', stay: toWaage ? rnd(4, 6.5) : rnd(2, 4.5), col: pick(SHIRTS), t: 0, step: 0 });
}
function updateKunden(dt) {
  for (const k of [...G.kunden]) {
    k.t += dt;
    if (k.state === 'stehen') {
      k.stay -= dt;
      if (k.stay <= 0) {
        const g = pick(OG.kundenTore), i = R.nearestFree(g[0], g[1]);
        k.path = R.path(k.x, k.y, [i]) || []; k.state = 'raus';
      }
      continue;
    }
    if (!moveAlong(k, 1.5 * dt)) {
      if (k.state === 'gehen') k.state = 'stehen';
      else G.kunden = G.kunden.filter(x => x !== k);
    }
  }
}
function kundenCells() {
  const s = new Set();
  for (const k of G.kunden) s.add(R.idx(k.x, k.y));
  return s;
}

// ---------- Bewegung ----------
function moveAlong(a, dist) {
  while (dist > 0 && a.path.length) {
    const [tx, ty] = a.path[0], dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (d > 1e-4) a.dir = Math.atan2(dy, dx);
    if (d <= dist) { a.x = tx; a.y = ty; a.path.shift(); dist -= d; } else { a.x += dx / d * dist; a.y += dy / d * dist; dist = 0; }
    a.step += 1;
  }
  return a.path.length > 0;
}
function updateFigur(f, dt) {
  f.dashT = Math.max(0, f.dashT - dt);
  const sp = f.speed * (f.dashT > 0 ? DASH.mult : 1);
  if (G.joy && G.joy.fig === f && (G.joy.vx || G.joy.vy)) {
    const nx = f.x + G.joy.vx * sp * dt, ny = f.y + G.joy.vy * sp * dt;
    const ok = (x, y) => R.free(R.idx(x, y)) || R.idx(x, y) === R.idx(f.x, f.y);
    if (ok(nx, ny)) { f.x = nx; f.y = ny; } else if (ok(nx, f.y)) f.x = nx; else if (ok(f.x, ny)) f.y = ny;
    f.dir = Math.atan2(G.joy.vy, G.joy.vx); f.step++;
    return;
  }
  if (f.work) {
    f.work.t += dt * (f.dashT > 0 ? 1 : 1);
    if (f.work.t >= f.work.dur) { const w = f.work; f.work = null; w.done(); updateBar(); }
    return;
  }
  if (!f.path.length) return;
  // Kunde direkt vor der Figur? Kurz warten, dann außen herum
  const [tx, ty] = f.path[0], d = Math.hypot(tx - f.x, ty - f.y) || 1;
  const ax = f.x + (tx - f.x) / d * 0.45, ay = f.y + (ty - f.y) / d * 0.45;
  const blocker = G.kunden.find(k => Math.hypot(k.x - ax, k.y - ay) < 0.55);
  if (blocker) {
    f.wait += dt;
    if (f.wait > 0.5) {
      f.wait = 0;
      const tg = f.target, ex = kundenCells();
      const goals = tg && tg.st ? tg.st.cells : tg && tg.lg ? neighbours(tg.lg.cell) : [R.idx(...f.path[f.path.length - 1])];
      const p = R.path(f.x, f.y, goals, ex);
      if (p) f.path = p;
    }
    return;
  }
  f.wait = 0;
  if (!moveAlong(f, sp * dt) && f.target) arrive(f);
}

// ---------- Spielschleife ----------
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (G && G.running && !G.paused) {
    for (let i = 0; i < FAST; i++) update(dt);
  }
  draw(now / 1000, dt);
  requestAnimationFrame(frame);
}
function update(dt) {
  G.t += dt;
  if (!G.finale && RUNDE - G.t <= FINALE) {
    G.finale = true; musik.finale = true;
    toast('Endspurt! Doppelte Punkte!', 'ot'); snd.play('gong'); vib([40, 40, 40]);
  }
  G.nextOrder -= dt;
  if (G.nextOrder <= 0 && G.orders.length < MAX_AUFTRAEGE) {
    spawnOrder();
    G.nextOrder = (G.finale ? rnd(3.8, 5) : lerp(9.5, 5.5, G.t / (RUNDE - FINALE)) * rnd(0.85, 1.15)) * (MIT_AZUBI ? 1 : 1.5);
  }
  G.nextKunde -= dt;
  if (G.nextKunde <= 0) {
    if (G.kunden.length < Math.round(lerp(2, 4, G.t / RUNDE))) spawnKunde();
    G.nextKunde = rnd(3, 6);
  }
  G.dashCool = Math.max(0, G.dashCool - dt);
  updateOrders(dt);
  updateKunden(dt);
  for (const f of Object.values(G.fig)) updateFigur(f, dt);
  for (const l of G.leergut) l.t += dt;
  G.floats = G.floats.filter(fl => (fl.t += dt) < 1.4);
  musik.druck = G.orders.reduce((m, o) => Math.max(m, o.t / o.life), 0);
  if (BOT) bot();
  updateHud(); updateOrderBars(); updateBar();
  if (G.t >= RUNDE) endRound();
}

// ---------- Zeichnen: 3D-Welt (welt3d.js) und darüber eine 2D-Überlage für Anzeigen ----------
const cv = $('cv');
const ov = $('ov'), ctx = ov.getContext('2d');
let WELT = null, V = { w: 1, h: 1, dpr: 1 };
function resize() {
  const r = $('field').getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  V = { w: r.width, h: r.height, dpr };
  ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr);
  if (WELT) WELT.resize(r.width, r.height);
}
window.addEventListener('resize', resize);

function text(t, x, y, size, col = '#2b2b2e', weight = 700, align = 'center') {
  ctx.font = `${weight} ${size}px "Open Sans", "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y);
}
function pill(t, x, y, size, bg, fg) {
  ctx.font = `800 ${size}px "Open Sans", "Segoe UI", Arial, sans-serif`;
  const w = ctx.measureText(t).width + size * 1.1, h = size * 1.7;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  text(t, x, y + 0.5, size, fg, 800);
}
function icon(ware, x, y, size, alpha = 1) {
  const im = ICON[ware];
  if (!im || !im.complete || !im.naturalWidth) return;
  ctx.globalAlpha = alpha; ctx.drawImage(im, x - size / 2, y - size / 2, size, size); ctx.globalAlpha = 1;
}
const LAGER_NAMEN = { palette: 'Palette', sortier: 'Sortiertisch', retoure: 'Retoure ❄', presse: 'Presse ♻', waage: 'Waage' };

function zielStationen(f) {
  const z = new Set();
  if (!G || !f) return z;
  const h = f.hold;
  if (f.target && f.target.st) z.add(f.target.st.id);
  if (h && h.typ === 'leer') z.add('presse');
  else if (h && h.typ === 'retoure') z.add('retoure');
  else if (!h && G.retoureTisch >= 2) z.add('sortier');
  else if (h && h.state === 'roh') z.add('sortier');
  else if (!h && G.palette.length) z.add('palette');
  return z;
}

function draw(time, dt) {
  if (!WELT) return;
  const f = G ? G.fig[G.active] : null;
  WELT.update(G, dt, f, new Set(G ? G.orders.map(o => o.ware) : []), zielStationen(f));
  WELT.render();
  ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  ctx.clearRect(0, 0, V.w, V.h);
  const P = (x, y, z) => WELT.screen(x, y, z);
  // Namen der Lager-Stationen
  for (const s of ST) {
    if (!LAGER_NAMEN[s.id]) continue;
    const [x, y] = P(s.body[0], s.id === 'presse' ? 2.7 : 1.35, s.body[1]);
    pill(LAGER_NAMEN[s.id], x, y, 10, 'rgba(43,43,46,.82)', '#fff');
  }
  if (!G) return;
  // Weg der aktiven Figur
  if (f.path.length) {
    ctx.setLineDash([5, 6]); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...P(f.x, 0.05, f.y)); for (const p of f.path) ctx.lineTo(...P(p[0], 0.05, p[1])); ctx.stroke(); ctx.setLineDash([]);
  }
  // Auftrags-Blasen über den Fächern, die nachgefüllt werden müssen
  for (const o of G.orders) {
    const rest = 1 - o.t / o.life, col = rest < 0.25 ? '#e2231a' : rest < 0.55 ? '#f5b400' : '#3c9a3c';
    for (const s of WST[o.ware]) {
      const [x, y] = P(s.body[0], 2.6, s.body[1]);
      const bob = Math.sin(time * 4 + o.id) * 2.5;
      ctx.beginPath(); ctx.moveTo(x - 6, y + 14 + bob); ctx.lineTo(x + 6, y + 14 + bob); ctx.lineTo(x, y + 22 + bob); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + bob, 17, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + bob, 17, -Math.PI / 2, -Math.PI / 2 + rest * Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke();
      icon(o.ware, x, y + bob, 22);
    }
  }
  // Figuren: Name, Fortschrittskreis
  for (const fg of Object.values(G.fig)) {
    const [x, y] = P(fg.x, fg.key === 'teddy' ? 4.1 : 3.9, fg.y);
    if (fg.work) {
      const p = clamp(fg.work.t / fg.work.dur, 0, 1), cy = y - 18;
      ctx.beginPath(); ctx.arc(x, cy, 16, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, cy, 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.strokeStyle = fg.work.label.startsWith('Wälzen') ? '#f5b400' : '#3c9a3c'; ctx.lineWidth = 5; ctx.stroke();
      pill(fg.work.label, x, cy - 26, 10, 'rgba(43,43,46,.88)', '#fff');
    } else if (G.active !== fg.key) {
      pill(fg.name, x, y - 4, 9, 'rgba(255,255,255,.85)', '#2b2b2e');
    }
  }
  // Punkte-Texte
  for (const fl of G.floats) {
    const [x, y] = P(fl.x, 2.8 + fl.t * 1.8, fl.y);
    ctx.globalAlpha = 1 - fl.t / 1.4;
    ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.font = '900 19px "Open Sans", Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.strokeText(fl.text, x, y); text(fl.text, x, y, 19, fl.good ? '#2e8b2e' : '#e2231a', 900);
    ctx.globalAlpha = 1;
  }
  // Nächster Schritt für die aktive Figur im freien Bereich über dem Spielfeld
  if (G.running && WELT.top > 40) {
    const h = f.hold, name = f.name;
    const tipp = f.work ? `${name}: ${f.work.label} …`
      : !h ? (G.palette.length ? `${name}: Auftrag oder Palette antippen` : `${name}: Leergut wegräumen oder warten`)
      : h.typ === 'leer' ? `${name}: Leergut zur Presse bringen`
      : h.typ === 'retoure' ? `${name}: Retoure ins Kühlhaus bringen`
      : h.state === 'roh' ? `${name}: ab zum Sortiertisch`
      : `${name}: ${OG.ware[h.ware].name} ins Fach – ${OG.ware[h.ware].temp === 'kuehl' ? '❄ Kühlung' : '☀ Raumtemperatur'}`;
    text(tipp, V.w / 2, Math.max(16, WELT.top - 20), 14, 'rgba(255,255,255,.92)', 700);
  }
  // Joystick
  if (G.joy && G.joy.show) {
    const j = G.joy;
    ctx.beginPath(); ctx.arc(j.sx, j.sy, 46, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(j.sx + j.vx * 40, j.sy + j.vy * 40, 20, 0, 7); ctx.fillStyle = 'rgba(204,7,30,.8)'; ctx.fill();
  }
}

// ---------- Eingabe ----------
let ptr = null;
cv.addEventListener('pointerdown', e => {
  if (!G || !G.running || G.paused) return;
  snd.unlock();
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect();
  ptr = { id: e.pointerId, sx: e.clientX - r.left, sy: e.clientY - r.top, t: performance.now(), joy: false };
});
cv.addEventListener('pointermove', e => {
  if (!ptr || ptr.id !== e.pointerId) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const dx = x - ptr.sx, dy = y - ptr.sy, d = Math.hypot(dx, dy);
  if (!ptr.joy && d > 24) {
    ptr.joy = true;
    const f = G.fig[G.active];
    f.path = []; f.target = null; f.work = null;
    G.joy = { fig: f, sx: ptr.sx, sy: ptr.sy, vx: 0, vy: 0, show: true };
  }
  if (ptr.joy && G.joy) { const m = Math.max(d, 40); G.joy.vx = dx / m; G.joy.vy = dy / m; }
});
const endPtr = e => {
  if (!ptr || ptr.id !== e.pointerId) return;
  const was = ptr; ptr = null;
  if (was.joy) { G.joy = null; return; }
  tap(was.sx, was.sy);
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', e => { ptr = null; if (G) G.joy = null; });

// Antippen am Bildschirm (sx, sy in CSS-Pixeln des Spielfelds)
function tap(sx, sy) {
  vib(8);
  const f = G.fig[G.active];
  // 1. Figur antippen = wechseln (Treffer am Bildschirm, Figuren sind hoch)
  for (const k of Object.keys(G.fig)) {
    const o = G.fig[k], [x, y] = WELT.screen(o.x, 1.6, o.y);
    if (Math.hypot(x - sx, y - sy) < 34) { if (k !== G.active) setActive(k); return; }
  }
  // Treffpunkt auf dem Boden und auf Tischhöhe (hohe Möbel werden weiter oben angetippt)
  const pts = [WELT.ground(sx, sy, 0), WELT.ground(sx, sy, 0.45), WELT.ground(sx, sy, 0.95)].filter(Boolean);
  if (!pts.length) return;
  // 2. Leergut
  let lg = null, ld = 0.9;
  for (const l of G.leergut) for (const [x, y] of pts.slice(0, 2)) { const d = Math.hypot(l.x - x, l.y - y); if (d < ld) { ld = d; lg = l; } }
  if (lg) return command(f, { lg });
  // 3. Station (großzügige Trefferfläche)
  let st = null, sd = 0.8;
  for (const s of ST) for (const [x, y] of pts) { const d = boxDist(s.body, x, y); if (d < sd) { sd = d; st = s; } }
  if (st) return command(f, { st });
  // 4. einfach hinlaufen
  command(f, { x: pts[0][0], y: pts[0][1] });
}

$('btn-switch').addEventListener('click', () => { if (G && G.running && MIT_AZUBI) setActive(G.active === 'teddy' ? 'azubi' : 'teddy'); });
if (!MIT_AZUBI) { document.body.classList.add('solo'); }
$('btn-dash').addEventListener('click', dash);
function dash() {
  if (!G || !G.running || G.paused || G.dashCool > 0) return;
  G.fig[G.active].dashT = DASH.dur; G.dashCool = DASH.cool; snd.play('squeak'); vib(20); updateBar();
}
document.addEventListener('keydown', e => {
  if (!G || !G.running) return;
  if (e.code === 'Space') { e.preventDefault(); if (MIT_AZUBI) setActive(G.active === 'teddy' ? 'azubi' : 'teddy'); }
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dash();
  else if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  else if (e.code === 'KeyM') toggleTon();
});
function togglePause() {
  if (!G || !G.running) return;
  G.paused = !G.paused;
  $('s-pause').classList.toggle('hidden', !G.paused);
  $('btn-musik').textContent = `Musik: ${musik.on ? 'an' : 'aus'}`;
  if (snd.ctx) G.paused ? snd.ctx.suspend() : snd.ctx.resume();
}
function toggleTon() {
  const m = snd.toggle();
  $('btn-ton').textContent = m ? '🔇' : '🔊';
  if (musik.out) musik.out.gain.value = m || !musik.on ? 0 : 0.55;
}
$('btn-ton').textContent = snd.muted ? '🔇' : '🔊';
$('btn-ton').addEventListener('click', toggleTon);
$('btn-menu').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', () => { togglePause(); musik.stop(); startRound(); });
$('btn-musik').addEventListener('click', () => { musik.toggle(); if (snd.muted && musik.out) musik.out.gain.value = 0; $('btn-musik').textContent = `Musik: ${musik.on ? 'an' : 'aus'}`; });
$('btn-go').addEventListener('click', () => { snd.unlock(); startRound(); });
$('btn-again').addEventListener('click', () => { snd.unlock(); startRound(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.running && !G.paused) togglePause(); });
// kein Zoomen/Scrollen am Handy
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || !e.target.closest('.screen')) e.preventDefault(); }, { passive: false });

// ---------- Testbetrieb (?bot): spielt beide Figuren automatisch, um die Sterne-Grenzen einzustellen ----------
function bot() {
  for (const f of Object.values(G.fig)) {
    if (f.work || f.path.length || f.target) { f.denk = 0; continue; }
    f.denk = (f.denk || 0) + 1 / 30;
    if (f.denk < BOT_DENK) continue;              // ?bot=mensch: kurze Reaktionszeit wie beim echten Spielen
    const h = f.hold;
    if (h && h.typ === 'leer') { if (h.n < f.cap && G.leergut.length) { command(f, { lg: nearest(f, G.leergut) }); } else command(f, { st: station('presse') }); continue; }
    if (h && h.typ === 'retoure') { command(f, { st: station('retoure') }); continue; }
    if (!h && G.retoureTisch >= 2) { command(f, { st: station('sortier') }); continue; }
    if (h && h.state === 'roh') { command(f, { st: station('sortier') }); continue; }
    if (h && h.state === 'bereit') {
      const s = WST[h.ware].find(x => !blocked(x));
      if (s) command(f, { st: s });          // sonst warten, bis jemand das Leergut wegräumt
      continue;
    }
    const stoert = G.leergut.filter(l => ST.some(s => s.typ === 'regal' && s.cellSet.has(l.cell)));
    if (((f.key === 'azubi' || !MIT_AZUBI) && G.leergut.length && (!G.palette.length || G.leergut.length >= 3)) || stoert.length) { command(f, { lg: nearest(f, stoert.length ? stoert : G.leergut) }); continue; }
    if (G.palette.length) { command(f, { st: station('palette') }); continue; }
  }
}
const nearest = (f, arr) => arr.reduce((b, a) => Math.hypot(a.x - f.x, a.y - f.y) < Math.hypot(b.x - f.x, b.y - f.y) ? a : b);

// Testhilfe: Runde ohne Bildaufbau durchrechnen (nur mit ?bot sinnvoll)
const sim = (sek, dt = 1 / 30) => { while (G && G.running && sek > 0) { update(dt); sek -= dt; } return G; };
window.FC = { get G() { return G; }, ST, R: () => R, startRound, tap, sim };
load();
