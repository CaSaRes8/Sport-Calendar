const FD = 'https://api.football-data.org/v4';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/3/eventsseason.php';

const F1_SEASONS = [2026, 2027];
const MOTOR_SEASONS = [2026, 2027];

// Motor vía TheSportsDB (clave pública gratuita '3')
const MOTOR = [
  { category: 'MotoGP', emoji: '🏍️', leagueId: 4407 },
  { category: 'WRC', emoji: '🚗', leagueId: 4409 },
  { category: 'WEC', emoji: '🏁', leagueId: 4413 },
  { category: 'GT', emoji: '🚘', leagueId: 4487 },
];

// Equipos de fútbol. Se identifican por ID o por nombre (el Deportivo NO puede
// coincidir solo con "Deportivo": "Deportivo Alavés" también lo contiene).
const TEAMS = [
  { name: 'FC Barcelona', emoji: '🔵🔴', match: (t) => t?.id === 81 },
  { name: 'Real Madrid', emoji: '⚪', match: (t) => t?.id === 86 },
  {
    name: 'RC Deportivo',
    emoji: '🔵⚪',
    match: (t) =>
      t?.id === 560 ||
      (/deportivo/i.test(`${t?.name} ${t?.shortName}`) && /coru[nñ]a/i.test(`${t?.name} ${t?.shortName}`)),
  },
];

const get = (url, headers = {}) =>
  fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(9000) }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  });

// ---------- Fórmula 1 (Jolpi / Ergast) ----------

async function getF1Season(year) {
  try {
    const data = await (await get(`https://api.jolpi.ca/ergast/f1/${year}.json`)).json();
    const out = [];
    for (const r of data?.MRData?.RaceTable?.Races || []) {
      const date = new Date(`${r.date}T${r.time || '14:00:00Z'}`);
      if (isNaN(date)) continue;
      const loc = r.Circuit?.Location || {};
      out.push({
        id: `f1-${r.season}-${r.round}`,
        title: `🏎️ F1: ${r.raceName}`,
        category: 'F1',
        tags: ['F1'],
        type: 'motorsport',
        date: date.toISOString(),
        location: [r.Circuit?.circuitName, [loc.locality, loc.country].filter(Boolean).join(', ')]
          .filter(Boolean)
          .join(' · ') || 'F1',
      });
    }
    return { events: out, diagnostics: [`F1 ${year}: ${out.length} carreras`] };
  } catch (err) {
    console.warn(`[f1:${year}] ${err.message}`);
    return { events: [], diagnostics: [`F1 ${year}: ${err.message}`] };
  }
}

// ---------- Motor (TheSportsDB eventsseason) ----------

async function getMotorSeason({ category, emoji, leagueId }, season) {
  try {
    const data = await (await get(`${TSDB}?id=${leagueId}&s=${season}`)).json();
    if (!data || !Array.isArray(data.events)) {
      return { events: [], diagnostics: [`${category} ${season}: sin eventos publicados`] };
    }
    const out = [];
    for (const ev of data.events) {
      if (!ev?.dateEvent) continue;
      let time = String(ev.strTime || '').match(/^\d{2}:\d{2}(:\d{2})?/)?.[0] || '12:00:00';
      if (time.length === 5) time += ':00';
      const date = new Date(`${ev.dateEvent}T${time}Z`);
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
    return { events: out, diagnostics: [`${category} ${season}: ${out.length} eventos`] };
  } catch (err) {
    console.warn(`[tsdb:${category}:${season}] ${err.message}`);
    return { events: [], diagnostics: [`${category} ${season}: ${err.message}`] };
  }
}

// ---------- Fútbol (football-data.org v4) ----------

// Última respuesta buena por competición, por si hay 429 o fallo de red
const fdCache = { PD: [], CL: [] };

const teamLabel = (t) => t?.shortName || t?.name || 'Por definir';

async function getFootballCompetition(code, key) {
  const isCL = code === 'CL';
  try {
    // SCHEDULED = fecha sin hora confirmada; TIMED = hora confirmada. Se piden ambos.
    const r = await fetch(`${FD}/competitions/${code}/matches?status=SCHEDULED,TIMED`, {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(9000),
    });
    if (r.status === 429) {
      console.warn(`[football:${code}] 429, se sirve la última respuesta guardada`);
      return { events: fdCache[code], diagnostics: [`${code}: 429, datos en caché`] };
    }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);

    const events = [];
    for (const m of (await r.json()).matches || []) {
      const mine = TEAMS.filter((t) => t.match(m.homeTeam) || t.match(m.awayTeam));
      if (!isCL && !mine.length) continue; // en LaLiga solo nuestros equipos
      const date = new Date(m.utcDate);
      if (isNaN(date)) continue;

      const emoji = isCL ? '🏆' : mine[0].emoji;
      events.push({
        id: `fd-${m.id}`,
        title: `${emoji} ${teamLabel(m.homeTeam)} vs ${teamLabel(m.awayTeam)}`,
        category: isCL ? 'Champions League' : mine[0].name,
        // tags: los partidos de Champions de nuestros equipos también salen en sus filtros
        tags: isCL ? ['Champions', ...mine.map((t) => t.name)] : mine.map((t) => t.name),
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
  // Una petición por competición (2 en total)
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

  const jobs = [
    ...F1_SEASONS.map(getF1Season),
    ...MOTOR.flatMap((m) => MOTOR_SEASONS.map((s) => getMotorSeason(m, s))),
    getFootball(),
  ];
  const settled = await Promise.allSettled(jobs);

  let events = [];
  const diagnostics = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue; // fallo silencioso
    events = events.concat(r.value.events || []);
    diagnostics.push(...(r.value.diagnostics || []));
  }

  // Desde las 00:00:00 de hoy (UTC) en adelante, sin duplicados, orden ascendente
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

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: events.length, warnings: [], diagnostics, events });
}
