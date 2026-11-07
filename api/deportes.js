import ical from 'ical';

const YEAR = 2026;
const FD = 'https://api.football-data.org/v4';

// Equipos (football-data.org). El ID del Dépor se puede sobrescribir con DEPOR_ID.
const TEAMS = [
  { id: 81, name: 'FC Barcelona' },
  { id: 86, name: 'Real Madrid' },
  { id: Number(process.env.DEPOR_ID || 241), name: 'RC Deportivo' },
];

// Feeds iCal comunitarios. Cada campeonato prueba sus URLs en orden hasta que una responde.
// Una variable de entorno (opcional, admite varias URLs separadas por coma) se prueba la primera.
const ICS_FEEDS = [
  { category: 'MotoGP', env: 'ICS_MOTOGP', urls: [
    'https://files-motogp.motorsportcalendars.com/motogp-calendar.ics',
    'https://files-motogp.motorsportcalendars.com/motogp-calendar_gp_sprint_qualifying.ics',
  ] },
  { category: 'WRC', env: 'ICS_WRC', urls: [
    'https://files-wrc.motorsportcalendars.com/wrc-calendar.ics',
  ] },
  { category: 'WEC', env: 'ICS_WEC', urls: [
    'https://files-wec.motorsportcalendars.com/wec-calendar.ics',
  ] },
  { category: 'GT', env: 'ICS_GT', urls: [
    'https://files-gt-world-challenge-europe.motorsportcalendars.com/gt-world-challenge-europe-calendar.ics',
    'https://files-gtwc-europe.motorsportcalendars.com/gtwc-europe-calendar.ics',
  ] },
];

const get = (url, headers = {}) =>
  fetch(url, { headers, signal: AbortSignal.timeout(9000) }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  });

const iso = (date, time) => new Date(time ? `${date}T${time}` : `${date}T12:00:00Z`).toISOString();

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

async function getIcs({ category, env, urls }) {
  const candidates = [...(process.env[env] ? process.env[env].split(',').map((u) => u.trim()) : []), ...urls];
  for (const url of candidates) {
    try {
      const text = await (await get(url)).text();
      const parsed = ical.parseICS(text);
      const events = Object.values(parsed)
        .filter((e) => e.type === 'VEVENT' && e.start)
        .map((e) => ({
          id: `${category.toLowerCase()}-${e.uid || e.start.toISOString() + e.summary}`,
          title: String(e.summary || category).replace(/\s+/g, ' ').trim(),
          category,
          tags: [category],
          type: 'motorsport',
          date: new Date(e.start).toISOString(),
          location: String(e.location || '').trim() || category,
        }));
      if (events.length) return { events, diagnostics: [] };
    } catch (err) {
      console.warn(`[ics:${category}] ${url} -> ${err.message}`);
    }
  }
  // Silencioso para la interfaz: solo queda en diagnostics y en los logs de Vercel.
  return { events: [], diagnostics: [`${category}: ningún feed respondió`] };
}

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
    if (date.getUTCFullYear() > YEAR) return;
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

  // 1 petición: toda la liga española, filtrada localmente
  // 1 petición más: Champions League (2 en total, muy por debajo de las 10/min del plan gratuito)
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
  // Con 429 (o fallo total) se sirve lo último que funcionó en vez de romper la función
  const events = byId.size ? [...byId.values()] : rateLimited ? lastFootball : [];
  return { events, warnings };
}

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

  const cutoff = Date.now() - 3 * 3600 * 1000; // mantiene lo que acaba de empezar
  events = events
    .filter((e) => new Date(e.date).getTime() >= cutoff && new Date(e.date).getUTCFullYear() === YEAR)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: events.length, warnings, diagnostics, events });
}
