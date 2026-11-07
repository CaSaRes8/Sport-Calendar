import ical from 'ical';

const YEAR = 2026;
const FD = 'https://api.football-data.org/v4';

// Equipos (football-data.org). El ID del Dépor se puede sobrescribir con DEPOR_ID.
const TEAMS = [
  { id: 81, name: 'FC Barcelona' },
  { id: 86, name: 'Real Madrid' },
  { id: Number(process.env.DEPOR_ID || 241), name: 'RC Deportivo' },
];

// Feeds iCal comunitarios. Sobrescribe cualquiera con su variable de entorno.
const ICS_FEEDS = [
  { category: 'MotoGP', env: 'ICS_MOTOGP', url: 'https://files-motogp.motorsportcalendars.com/motogp-calendar.ics' },
  { category: 'WRC', env: 'ICS_WRC', url: 'https://files-wrc.motorsportcalendars.com/wrc-calendar.ics' },
  { category: 'WEC', env: 'ICS_WEC', url: 'https://files-wec.motorsportcalendars.com/wec-calendar.ics' },
  { category: 'GT', env: 'ICS_GT', url: 'https://files-gt.motorsportcalendars.com/gt-calendar.ics' },
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

async function getIcs({ category, env, url }) {
  const text = await (await get(process.env[env] || url)).text();
  const parsed = ical.parseICS(text);
  return Object.values(parsed)
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
}

async function getFootball() {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('Falta FOOTBALL_DATA_KEY');
  const headers = { 'X-Auth-Token': key };
  const q = 'status=SCHEDULED,TIMED';
  const jobs = [
    ...TEAMS.map((t) => get(`${FD}/teams/${t.id}/matches?${q}`, headers).then((r) => r.json())),
    get(`${FD}/competitions/CL/matches?${q}`, headers).then((r) => r.json()),
  ];
  const results = await Promise.allSettled(jobs);
  const warnings = [];
  const byId = new Map();
  results.forEach((res, i) => {
    const label = i < TEAMS.length ? TEAMS[i].name : 'Champions League';
    if (res.status === 'rejected') return warnings.push(`${label}: ${res.reason.message}`);
    for (const m of res.value.matches || []) {
      const date = new Date(m.utcDate);
      if (date.getUTCFullYear() > YEAR) continue;
      const id = `fd-${m.id}`;
      const ev = byId.get(id) || {
        id,
        title: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name}`,
        category: 'Champions League',
        tags: [],
        type: 'futbol',
        date: date.toISOString(),
        location: m.competition?.name || 'Fútbol',
      };
      const ids = [m.homeTeam.id, m.awayTeam.id];
      TEAMS.forEach((t) => ids.includes(t.id) && !ev.tags.includes(t.name) && ev.tags.push(t.name));
      if (m.competition?.code === 'CL' && !ev.tags.includes('Champions')) ev.tags.push('Champions');
      const first = TEAMS.find((t) => ev.tags.includes(t.name));
      if (first) ev.category = first.name;
      byId.set(id, ev);
    }
  });
  return { events: [...byId.values()], warnings };
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

  const warnings = [];
  let events = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') return warnings.push(`${jobs[i].label}: ${r.reason.message}`);
    if (Array.isArray(r.value)) events = events.concat(r.value);
    else {
      events = events.concat(r.value.events);
      warnings.push(...r.value.warnings);
    }
  });

  const cutoff = Date.now() - 3 * 3600 * 1000; // mantiene lo que acaba de empezar
  events = events
    .filter((e) => new Date(e.date).getTime() >= cutoff && new Date(e.date).getUTCFullYear() === YEAR)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: events.length, warnings, events });
}
