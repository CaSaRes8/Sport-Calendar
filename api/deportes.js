import ical from 'ical';

const YEAR = 2026;
const YEAR_START = Date.UTC(YEAR, 0, 1);
const YEAR_END = Date.UTC(YEAR + 1, 0, 1);
const FD = 'https://api.football-data.org/v4';

// Equipos (football-data.org). El ID del Dépor se puede sobrescribir con DEPOR_ID.
const TEAMS = [
  { id: 81, name: 'FC Barcelona' },
  { id: 86, name: 'Real Madrid' },
  { id: Number(process.env.DEPOR_ID || 241), name: 'RC Deportivo' },
];

// Feeds iCal. Orden de prueba: variable de entorno (admite varias URLs separadas por coma) -> fallbacks.
const ICS_FEEDS = [
  {
    category: 'MotoGP',
    env: 'ICS_MOTOGP',
    urls: [
      'https://files-f1cal.b-cdn.net/motogp-2026.ics',
      'https://raw.githubusercontent.com/motorsport-calendars/calendars/main/motogp.ics',
      'https://files-motogp.motorsportcalendars.com/motogp-calendar.ics',
    ],
  },
  {
    category: 'WRC',
    env: 'ICS_WRC',
    urls: [
      'https://raw.githubusercontent.com/motorsport-calendars/calendars/main/wrc.ics',
      'https://files-wrc.motorsportcalendars.com/wrc-calendar.ics',
    ],
  },
  {
    category: 'WEC',
    env: 'ICS_WEC',
    urls: [
      'https://raw.githubusercontent.com/motorsport-calendars/calendars/main/wec.ics',
      'https://files-wec.motorsportcalendars.com/wec-calendar.ics',
    ],
  },
  {
    category: 'GT',
    env: 'ICS_GT',
    urls: [
      'https://raw.githubusercontent.com/motorsport-calendars/calendars/main/gt-world-challenge-europe.ics',
      'https://files-gt-world-challenge-europe.motorsportcalendars.com/gt-world-challenge-europe-calendar.ics',
    ],
  },
];

const get = (url, headers = {}) =>
  fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(9000) }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  });

const iso = (date, time) => new Date(time ? `${date}T${time}` : `${date}T12:00:00Z`).toISOString();

// ---------- Utilidades iCal ----------

// Acepta Date, {val}, 'YYYYMMDD', 'YYYYMMDDTHHMMSS(Z)' o cualquier string parseable.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'object' && v.val !== undefined) return toDate(v.val);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // DTSTART;VALUE=DATE:20260301
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m.map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, mi, se)); // sin Z se asume UTC
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const clean = (v) =>
  String(v?.val ?? v ?? '')
    .replace(/\\n/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUrl = (u) => u.trim().replace(/^webcal:\/\//i, 'https://');

async function getIcs({ category, env, urls }) {
  const fromEnv = process.env[env] ? process.env[env].split(',') : [];
  const candidates = [...fromEnv, ...urls].map(normalizeUrl).filter(Boolean);

  for (const url of candidates) {
    try {
      const text = await (await get(url)).text();
      const parsed = ical.parseICS(text);
      const events = [];

      for (const e of Object.values(parsed)) {
        if (!e || e.type !== 'VEVENT') continue;
        const start = toDate(e.start ?? e.dtstart);
        if (!start) continue;
        const title = clean(e.summary) || category;
        events.push({
          id: `${category.toLowerCase()}-${clean(e.uid) || `${start.toISOString()}-${title}`}`,
          title,
          category, // exactamente 'MotoGP' | 'WRC' | 'WEC' | 'GT'
          tags: [category],
          type: 'motorsport',
          date: start.toISOString(),
          location: clean(e.location) || category,
        });
      }

      if (events.length) {
        return { events, diagnostics: [`${category}: ${events.length} eventos desde ${url}`] };
      }
      console.warn(`[ics:${category}] ${url} -> 0 eventos válidos`);
    } catch (err) {
      console.warn(`[ics:${category}] ${url} -> ${err.message}`);
    }
  }
  // Silencioso para la interfaz: solo queda en diagnostics y en los logs de Vercel.
  return { events: [], diagnostics: [`${category}: ningún feed respondió`] };
}

// ---------- F1 (Jolpi / Ergast) ----------

async function getF1() {
  const data = await (await get(`https://api.jolpi.ca/ergast/f1/${YEAR}.json`)).json();
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
      out.push({
        id: `f1-${race.season}-${race.round}-${label}`,
        title: `${race.raceName.replace('Grand Prix', 'GP')} – ${label}`,
        category: 'F1',
        tags: ['F1'],
        type: 'motorsport',
        date: iso(d, t),
        location: place,
      });
    }
  }
  return out;
}

// ---------- Fútbol (football-data.org) ----------

let lastFootball = []; // última respuesta buena, por si hay 429

async function fdMatches(path, headers) {
  const r = await fetch(`${FD}${path}`, { headers, signal: AbortSignal.timeout(9000) });
  if (r.status === 429) {
    const e = new Error('límite de peticiones (429)');
    e.rateLimited = true;
    throw e;
  }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()).matches || [];
}

async function getFootball() {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return { events: [], warnings: ['Fútbol: falta FOOTBALL_DATA_KEY'] };
  const headers = { 'X-Auth-Token': key };
  const q = '?status=SCHEDULED,TIMED';
  const ours = new Map(TEAMS.map((t) => [t.id, t.name]));
  const warnings = [];
  const byId = new Map();

  const add = (m, isCL) => {
    const date = new Date(m.utcDate);
    const mine = [m.homeTeam.id, m.awayTeam.id].filter((id) => ours.has(id)).map((id) => ours.get(id));
    if (!isCL && !mine.length) return; // en la liga solo nos interesan nuestros equipos
    const id = `fd-${m.id}`;
    const ev = byId.get(id) || {
      id,
      title: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name}`,
      category: mine[0] || 'Champions League',
      tags: [],
      type: 'futbol',
      date: date.toISOString(),
      location: m.competition?.name || (isCL ? 'UEFA Champions League' : 'LaLiga'),
    };
    mine.forEach((n) => !ev.tags.includes(n) && ev.tags.push(n));
    if (isCL && !ev.tags.includes('Champions')) ev.tags.push('Champions');
    byId.set(id, ev);
  };

  // 1 petición a toda la liga (filtrada en local) + 1 a la Champions
  const jobs = [
    ['LaLiga', `/competitions/PD/matches${q}`, false],
    ['Champions League', `/competitions/CL/matches${q}`, true],
  ];
  let rateLimited = false;
  for (const [label, path, isCL] of jobs) {
    try {
      (await fdMatches(path, headers)).forEach((m) => add(m, isCL));
    } catch (err) {
      if (err.rateLimited) rateLimited = true;
      warnings.push(`${label}: ${err.message}`);
    }
  }

  if (byId.size) lastFootball = [...byId.values()];
  const events = byId.size ? [...byId.values()] : rateLimited ? lastFootball : [];
  return { events, warnings };
}

// ---------- Handler ----------

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const jobs = [
    { label: 'F1', run: getF1 },
    ...ICS_FEEDS.map((f) => ({ label: f.category, run: () => getIcs(f) })),
    { label: 'Fútbol', run: getFootball },
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));

  const warnings = []; // se muestran en la interfaz
  const diagnostics = []; // solo para depurar, la interfaz no los pinta
  let events = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') return warnings.push(`${jobs[i].label}: ${r.reason.message}`);
    if (Array.isArray(r.value)) return (events = events.concat(r.value));
    events = events.concat(r.value.events);
    warnings.push(...(r.value.warnings || []));
    diagnostics.push(...(r.value.diagnostics || []));
  });

  // Todo el año 2026 (desde el 1 de enero), sin descartar eventos ya pasados; sin duplicados.
  const seen = new Set();
  events = events
    .filter((e) => {
      const t = new Date(e.date).getTime();
      if (isNaN(t) || t < YEAR_START || t >= YEAR_END) return false;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: events.length, warnings, diagnostics, events });
}
