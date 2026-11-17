// Verbindung zur Online-Bestenliste (Supabase, Datenbank-Funktionen aus supabase/setup.sql).
// Ohne Zugangsdaten in config.js läuft alles lokal auf dem Gerät.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const online = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    // Neue Schlüssel (sb_publishable_…) nur als apikey senden, alte anon-Schlüssel (JWT) zusätzlich als Bearer
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
      ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}) },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint)) || `Fehler ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Runde anmelden: Der Server würfelt Zettel und Angebot und merkt sich die Startzeit.
export function startRun(difficulty) { return rpc('teddy_start', { p_difficulty: difficulty }); }
// Startschuss (Countdown beginnt jetzt): Ab hier zählt die Uhr des Servers.
export function goRun(runId) { return rpc('teddy_go', { p_run: runId }); }
// Runde beenden: Server prüft Fahrtenbuch und Zeit und berechnet die Endzeit selbst.
export function finishRun(runId, log, clientTime) {
  return rpc('teddy_finish', { p_run: runId, p_log: log, p_time: clientTime });
}
export function saveName(runId, name) { return rpc('teddy_name', { p_run: runId, p_name: name }); }
export function leaderboard(difficulty) { return rpc('teddy_board', { p_difficulty: difficulty }); }

// ---------- Ersatz ohne Server: Bestenliste nur auf diesem Gerät ----------
export function weekStart(now = new Date()) {
  // Neue Woche: Sonntag 20 Uhr (deutsche Zeit, ungefähr über die Geräteuhr)
  const d = new Date(now);
  const shifted = new Date(d.getTime() + 4 * 3600e3);          // Sonntag 20 Uhr -> Montag 0 Uhr
  const day = (shifted.getDay() + 6) % 7;                         // Montag = 0
  const monday = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() - day);
  return new Date(monday.getTime() - 4 * 3600e3);
}

export function localBoard(difficulty) {
  const key = `teddy-board-${difficulty}-${weekStart().toISOString().slice(0, 10)}`;
  let rows = [];
  try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { rows = []; }
  return { key, rows };
}

export function localSave(difficulty, entry) {
  const { key, rows } = localBoard(difficulty);
  rows.push(entry);
  rows.sort((a, b) => a.final - b.final);
  const rank = rows.indexOf(entry);
  try { localStorage.setItem(key, JSON.stringify(rows.slice(0, 10))); } catch { /* voll oder gesperrt */ }
  return rank < 10 ? rank : -1;
}
