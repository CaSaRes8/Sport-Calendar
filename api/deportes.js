const FD = 'https://api.football-data.org/v4';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=';

// Equipos a destacar en LaLiga y en Champions (football-data.org)
const TEAMS = [
  { id: 81, name: 'FC Barcelona' },
  { id: 86, name: 'Real Madrid' },
  { id: Number(process.env.DEPOR_ID || 241), name: 'RC Deportivo' },
];

// Motor: TheSportsDB (API key gratuita '3')
const MOTOR = [
  { category: 'MotoGP', emoji: '🏍️', leagueId: 4407 },
  { category: 'WRC', emoji: '🚗', leagueId: 4409 },
  { category: 'WEC', emoji: '🏁', leagueId: 4413 },
  { category: 'GT', emoji: '🚘', leagueId: 4487 },
];

const get = (url, headers = {}) =>
  fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(9000) }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  });

// ---------- Motor: TheSportsDB ----------

async function getMotorsport({ category, emoji, leagueId }) {
  try {
    const data = await (await get(`${TSDB}${leagueId}`)).json();
    // events === null: temporada acabada o aún sin publicar -> se ignora la categoría sin error
    if (!data || !Array.isArray(data.events)) {
      return { events: [], diagnostics: [`${category}: sin eventos publicados`] };
    }

    const out = [];
    for (const ev of data.events) {
      if (!ev?.dateEvent) continue;
      const time = String(ev.strTime || '').match(/^\d{2}:\d{2}(:\d{2})?/)?.[0] || '12:00:00';
      const date = new Date(`${ev.dateEvent}T${time.length === 5 ? `${time}:00` : time}Z`);
      if (isNaN(date)) continue;

      const location = [ev.strVenue, ev.strCountry].map((s) => (s || '').trim()).filter(Boolean).join(', ');
      out.push({
        id: `${category.toLowerCase()}-${ev.idEvent}`,
        title: `${emoji} ${ev.strEvent || category}`,
        category, // exacto: 'MotoGP' | 'WRC' | 'WEC' | 'GT'
        tags: [category],
        type: 'motorsport',
        date: date.toISOString(),
        location: location || category,
      });
    }
    return { events: out, diagnostics: [`${category}: ${out.length} eventos`] };
  } catch (err) {
    console.warn(`[tsdb:${category}] ${err.message}`);
    return { events: [], diagnostics: [`${category}: ${err.message}`] };
  }
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

  const jobs = [getF1(), ...MOTOR.map(getMotorsport), getFootball()];
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
