import { Buffer } from 'node:buffer'; // (sin uso real; se puede borrar, no afecta)

const FD = 'https://api.football-data.org/v4';
const GH = 'https://raw.githubusercontent.com/motorsport-calendars/calendars/main/';

// Equipos a destacar en LaLiga y en Champions (football-data.org)
const TEAMS = [
  { id: 81, name: 'FC Barcelona' },
  { id: 86, name: 'Real Madrid' },
  { id: Number(process.env.DEPOR_ID || 241), name: 'RC Deportivo' },
];

// Feeds de motor: se prueban en orden hasta que uno devuelva eventos.
// Variable de entorno (opcional, URLs separadas por coma) -> GitHub motorsport-calendars -> alternativas.
const FEEDS = [
  {
    category: 'MotoGP',
    env: 'ICS_MOTOGP',
    urls: [
      `${GH}motogp.ics`,
      `${GH}motogp-2026.ics`,
      'https://files-f1cal.b-cdn.net/motogp-2026.ics',
      'https://files-motogp.motorsportcalendars.com/motogp-calendar.ics',
    ],
  },
  {
    category: 'WRC',
    env: 'ICS_WRC',
    urls: [`${GH}wrc.ics`, `${GH}wrc-2026.ics`, 'https://files-wrc.motorsportcalendars.com/wrc-calendar.ics'],
  },
  {
    category: 'WEC',
    env: 'ICS_WEC',
    urls: [`${GH}wec.ics`, `${GH}wec-2026.ics`, 'https://files-wec.motorsportcalendars.com/wec-calendar.ics'],
  },
  {
    category: 'GT',
    env: 'ICS_GT',
    urls: [
      `${GH}gt.ics`,
      `${GH}gtwc-europe.ics`,
      `${GH}gt-world-challenge-europe.ics`,
      'https://files-gt-world-challenge-europe.motorsportcalendars.com/gt-world-challenge-europe-calendar.ics',
    ],
  },
];

const get = (url, headers = {}) =>
  fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(9000) }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  });

// ---------- Parser iCal por regex ----------

// Convierte una hora local de una zona IANA (TZID) a UTC.
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return new Date(guess - (asUtc - guess));
  } catch {
    return new Date(guess);
  }
}

// DTSTART[;params]:valor -> Date válido en UTC (o null)
function parseDt(params = '', value = '') {
  const v = value.trim();
  const tz = (params.match(/TZID=([^;:]+)/i) || [])[1];
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/); // VALUE=DATE
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const s = +(m[6] || 0);
  if (m[7] === 'Z' || !tz) return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return zonedToUtc(y, mo, d, h, mi, s, tz);
}

const unescape = (s = '') =>
  s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').replace(/\s+/g, ' ').trim();

function parseIcs(text, category) {
  // Desdobla líneas (RFC 5545: las continuaciones empiezan por espacio o tab)
  const body = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const blocks = body.split(/BEGIN:VEVENT/i).slice(1);
  const out = [];
  for (const raw of blocks) {
    const block = raw.split(/END:VEVENT/i)[0];
    const prop = (name) => {
      const m = block.match(new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, 'mi'));
      return m ? { params: m[1] || '', value: m[2] || '' } : null;
    };
    const dt = prop('DTSTART');
    const date = dt && parseDt(dt.params, dt.value);
    if (!date || isNaN(date)) continue;
    const title = unescape(prop('SUMMARY')?.value) || category;
    const uid = unescape(prop('UID')?.value);
    out.push({
      id: `${category.toLowerCase()}-${uid || `${date.toISOString()}-${title}`}`,
      title,
      category, // exacto: 'MotoGP' | 'WRC' | 'WEC' | 'GT'
      tags: [category],
      type: 'motorsport',
      date: date.toISOString(),
      location: unescape(prop('LOCATION')?.value) || category,
    });
  }
  return out;
}

async function getMotorsport({ category, env, urls }) {
  const fromEnv = process.env[env] ? process.env[env].split(',') : [];
  const candidates = [...fromEnv, ...urls].map((u) => u.trim().replace(/^webcal:\/\//i, 'https://')).filter(Boolean);
  for (const url of candidates) {
    try {
      const events = parseIcs(await (await get(url)).text(), category);
      if (events.length) return { events, diagnostics: [`${category}: ${events.length} eventos desde ${url}`] };
      console.warn(`[ics:${category}] ${url} -> 0 eventos`);
    } catch (err) {
      console.warn(`[ics:${category}] ${url} -> ${err.message}`);
    }
  }
  return { events: [], diagnostics: [`${category}: ningún feed respondió`] };
}

// ---------- F1 (Jolpi / Ergast) ----------

async function getF1() {
  try {
    const data = await (await get('https://api.jolpi.ca/ergast/f1/2026.json')).json();
    const out = [];
    for (const race of data.MRData.RaceTable.Races) {
      const place = `${race.raceName} · ${race.Circuit.Location.locality}, ${race.Circuit.Location.country}`;
      const sessions = [
        ['GP', race.date, race.time],
        ['Clasificación', race.Qualifying?.date, race.Qualifying?.time],
        ['Sprint', race.Sprint?.date, race.Sprint?.time],
        ['Clasificación Sprint', race.SprintQualifying?.date, race.SprintQualifying?.time],
      ];
      for (const [label, d, t] of sessions) {
        if (!d) continue;
        const date = new Date(t ? `${d}T${t}` : `${d}T12:00:00Z`);
        if (isNaN(date)) continue;
        out.push({
          id: `f1-${race.season}-${race.round}-${label}`,
          title: `${race.raceName.replace('Grand Prix', 'GP')} – ${label}`,
          category: 'F1',
          tags: ['F1'],
          type: 'motorsport',
          date: date.toISOString(),
          location: place,
        });
      }
    }
    return { events: out, diagnostics: [`F1: ${out.length} eventos`] };
  } catch (err) {
    console.warn(`[f1] ${err.message}`);
    return { events: [], diagnostics: ['F1: sin respuesta'] };
  }
}

// ---------- Fútbol: LaLiga (PD) + Champions League (CL) ----------

// Última respuesta buena por competición, por si hay 429 o fallo de red
const fdCache = { PD: [], CL: [] };

async function getFootballCompetition(code, key) {
  const isCL = code === 'CL';
  try {
    const r = await fetch(`${FD}/competitions/${code}/matches?status=SCHEDULED,TIMED`, {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(9000),
    });
    if (r.status === 429) {
      console.warn(`[football:${code}] 429, se sirve la última respuesta guardada`);
      return { events: fdCache[code], diagnostics: [`${code}: 429, datos en caché`] };
    }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);

    const ours = new Map(TEAMS.map((t) => [t.id, t.name]));
    const events = [];
    for (const m of (await r.json()).matches || []) {
      const mine = [m.homeTeam?.id, m.awayTeam?.id].filter((id) => ours.has(id)).map((id) => ours.get(id));
      if (!isCL && !mine.length) continue; // en LaLiga solo Barça, Madrid (y Dépor si apareciera)
      const date = new Date(m.utcDate);
      if (isNaN(date)) continue;
      const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Por definir';
      const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Por definir';
      events.push({
        id: `fd-${m.id}`,
        title: `${home} vs ${away}`,
        category: mine[0] || (isCL ? 'Champions League' : 'LaLiga'),
        tags: isCL ? [...mine, 'Champions'] : mine, // un Barça–Madrid sale en ambos filtros
        type: 'futbol',
        date: date.toISOString(),
        location: m.competition?.name || (isCL ? 'UEFA Champions League' : 'LaLiga'),
      });
    }
    fdCache[code] = events;
    return { events, diagnostics: [`${code}: ${events.length} partidos`] };
  } catch (err) {
    console.warn(`[football:${code}] ${err.message}`);
    return { events: fdCache[code], diagnostics: [`${code}: ${err.message}`] };
  }
}

async function getFootball() {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return { events: [], diagnostics: ['Fútbol: falta FOOTBALL_DATA_KEY'] };
  // 2 peticiones en total (muy por debajo de las 10/min del plan gratuito)
  const [liga, champions] = await Promise.all([
    getFootballCompetition('PD', key),
    getFootballCompetition('CL', key),
  ]);
  return {
    events: [...liga.events, ...champions.events],
    diagnostics: [...liga.diagnostics, ...champions.diagnostics],
  };
}

// ---------- Handler ----------

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const jobs = [getF1(), ...FEEDS.map(getMotorsport), getFootball()];
  const settled = await Promise.allSettled(jobs);

  let events = [];
  const diagnostics = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue; // fallo silencioso
    events = events.concat(r.value.events || []);
    diagnostics.push(...(r.value.diagnostics || []));
  }

  // Desde el inicio de HOY (UTC) en adelante, sin duplicados, orden ascendente estricto
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const seen = new Set();
  events = events
    .filter((e) => {
      const t = Date.parse(e.date);
      if (isNaN(t) || t < today.getTime() || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: events.length, warnings: [], diagnostics, events });
}
