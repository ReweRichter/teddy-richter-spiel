// Namensprüfung für die Bestenliste. Die gleiche Liste prüft auch der Server (supabase/setup.sql),
// hier dient sie nur der schnellen Rückmeldung.

// Teilwörter: werden auch innerhalb eines Namens gefunden (z. B. "xArschx")
export const BAD_PARTS = [
  'arsch', 'fotze', 'fotz', 'votze', 'fick', 'fikk', 'ficker', 'wichs', 'wixx', 'wix', 'hure', 'nutte', 'schlampe',
  'bitch', 'fuck', 'fuk', 'shit', 'scheis', 'scheiss', 'kacke', 'pisse', 'pimmel', 'penis', 'schwanz', 'muschi',
  'titte', 'titten', 'porno', 'porn', 'sex', 'nackt', 'vagina', 'dildo', 'blowjob', 'cock', 'pussy', 'cunt',
  'whore', 'slut', 'bastard', 'hurensohn', 'missgeburt', 'spast', 'spasti', 'mongo', 'behindert', 'kanake', 'kanacke',
  'neger', 'nigger', 'nigga', 'kanak', 'zigeuner', 'schwuchtel', 'tunte', 'faggot', 'fag', 'transe', 'judensau',
  'hitler', 'nazi', 'heilhitler', 'siegheil', 'adolf', 'isis', 'taliban', 'terror',
  'kinderf', 'paedo', 'pedo', 'vergewalt', 'rape', 'nsdap', 'afd', 'npd', 'drogen', 'koks', 'kokain', 'heroin',
  'idiot', 'depp', 'trottel', 'vollpfosten', 'wichser', 'opfer', 'lutsch', 'orgasm', 'boobs',
  'arschloch', 'scheisse', 'verpiss', 'fresse', 'mistkerl', 'drecksau', 'kotz', 'drecksschwein',
];
// Ganze Wörter: kurze Wörter, die sonst in harmlosen Namen stecken könnten ("Klasse", "Assi"-Teil von "Kassierer")
export const BAD_WORDS = ['ass', 'dick', 'kkk', 'assi', 'hh', '88', '18', 'sieg', 'heil', 'tod', 'kill', 'nsu', 'xxx', 'gay', 'homo'];

export function normalize(s) {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o')
    .replace(/[5$]/g, 's').replace(/7/g, 't').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/y/g, 'i');
}

export function checkName(raw) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, msg: 'Bitte mindestens 2 Zeichen.' };
  if (name.length > 14) return { ok: false, msg: 'Höchstens 14 Zeichen.' };
  if (!/^[A-Za-zÄÖÜäöüß0-9 ._-]+$/.test(name)) return { ok: false, msg: 'Nur Buchstaben, Zahlen, Leerzeichen, Punkt und Strich.' };
  const plain = normalize(name).replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
  const words = name.toLowerCase().split(/[\s._-]+/).filter(Boolean);
  const bad = BAD_PARTS.some(w => plain.includes(w.replace(/(.)\1+/g, '$1').replace(/ck/g, 'k').replace(/y/g, 'i')))
    || words.some(w => BAD_WORDS.includes(w) || BAD_WORDS.includes(normalize(w)));
  if (bad) return { ok: false, msg: 'Dieser Name ist leider nicht erlaubt. Bitte wähle einen anderen.' };
  return { ok: true, name };
}
