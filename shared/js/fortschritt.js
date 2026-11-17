// Sterne und Bestwerte je Spiel, nur auf diesem Gerät (localStorage), nichts wird übertragen.
// Aufbau: { einkauf: { sterne, best: { leicht: 52.3, ... } }, 'frische-chef': { sterne, best: 1234, runden } }
const KEY = 'rr-spielwelt';

export function laden() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

function speichern(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* privates Fenster: dann eben nicht */ }
}

export function spiel(id) {
  return laden()[id] || { sterne: 0 };
}

// Sterne: es zählt immer der beste Wert. best: Zahl (höher = besser) oder {stufe: zeit} (niedriger = besser).
export function melden(id, { sterne = 0, punkte = null, stufe = null, zeit = null } = {}) {
  const d = laden();
  const s = d[id] || { sterne: 0 };
  s.sterne = Math.max(s.sterne || 0, sterne);
  s.runden = (s.runden || 0) + 1;
  let neu = false;
  if (punkte != null && (s.best == null || punkte > s.best)) { s.best = punkte; neu = true; }
  if (stufe && zeit != null) {
    s.best = typeof s.best === 'object' && s.best ? s.best : {};
    if (s.best[stufe] == null || zeit < s.best[stufe]) { s.best[stufe] = zeit; neu = true; }
  }
  d[id] = s;
  speichern(d);
  return { ...s, neuerRekord: neu };
}
