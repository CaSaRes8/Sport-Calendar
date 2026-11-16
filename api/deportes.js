const FD = 'https://api.football-data.org/v4';

const F1_SEASONS = [2026, 2027];
const MOTOR_SEASONS = [2026, 2027];

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

// ---------- Motor: MotoGP, WRC, WEC, GT ----------
// 1) JSON remoto de GitHub (formato sportstimes: { races: [{ name, location, slug, sessions: { race|gp } }] })
// 2) Por cada temporada (2026, 2027) en la que el remoto no devuelva nada, se usa el calendario estático.

const MOTOR = [
  { category: 'MotoGP', emoji: '🏍️', slug: 'motogp', env: 'JSON_MOTOGP' },
  { category: 'WRC', emoji: '🚗', slug: 'wrc', env: 'JSON_WRC' },
  { category: 'WEC', emoji: '🏁', slug: 'wec', env: 'JSON_WEC' },
  { category: 'GT', emoji: '🚘', slug: 'gt', env: 'JSON_GT' },
];

const GH = 'https://raw.githubusercontent.com/sportstimes';

// La variable de entorno (opcional) admite varias URLs separadas por coma y el marcador {year}.
const remoteUrls = ({ slug, env }, year) => [
  ...(process.env[env] ? process.env[env].split(',').map((u) => u.trim().replace('{year}', year)) : []),
  `${GH}/${slug}/main/_db/${slug}/${year}.json`,
  `${GH}/f1/main/_db/${slug}/${year}.json`,
];

async function getRemoteSeason(series, year) {
  for (const url of remoteUrls(series, year)) {
    try {
      const data = await (await get(url)).json();
      const out = [];
      (data?.races || []).forEach((race, i) => {
        const s = race.sessions || {};
        const date = new Date(s.race || s.gp || '');
        if (isNaN(date)) return;
        out.push({
          id: `${series.slug}-${year}-${race.slug || i}`,
          title: `${series.emoji} ${series.category}: ${race.name}`,
          category: series.category, // exacto: 'MotoGP' | 'WRC' | 'WEC' | 'GT'
          tags: [series.category],
          type: 'motorsport',
          date: date.toISOString(),
          location: race.location || race.name || series.category,
        });
      });
      if (out.length) return out;
    } catch (err) {
      console.warn(`[${series.slug}:${year}] ${url} -> ${err.message}`);
    }
  }
  return [];
}

// Calendario de respaldo. Las fuentes solo dan día (no hora): se fija a las 12:00 UTC y se marca
// "hora por confirmar". Solo incluye rondas con fecha publicada.
// [serie, fecha de la carrera/inicio (YYYY-MM-DD), nombre, ubicación]
const STATIC_EVENTS = [
  // ----- 2026: lo que queda por disputarse (WRC, WEC y GT ya terminaron su temporada 2026) -----
  ['MotoGP', '2026-11-22', 'GP de Portugal', 'Autódromo Internacional do Algarve, Portimão, Portugal'],
  ['MotoGP', '2026-11-29', 'GP de Valencia', 'Circuit Ricardo Tormo, Cheste, España'],

  // ----- 2027 -----
  // MotoGP (carrera del domingo)
  ['MotoGP', '2027-03-07', 'GP de Tailandia', 'Chang International Circuit, Buriram, Tailandia'],
  ['MotoGP', '2027-03-14', 'GP de Qatar', 'Lusail International Circuit, Qatar'],
  ['MotoGP', '2027-04-04', 'GP de Brasil', 'Brasil'],
  ['MotoGP', '2027-04-11', 'GP de Argentina', 'Autódromo Oscar y Juan Gálvez, Buenos Aires, Argentina'],
  ['MotoGP', '2027-04-25', 'GP de las Américas', 'Circuit of the Americas, Austin, EE. UU.'],
  ['MotoGP', '2027-05-09', 'GP de España', 'Circuito de Jerez, España'],
  ['MotoGP', '2027-05-16', 'GP de Francia', 'Le Mans, Francia'],
  ['MotoGP', '2027-05-30', 'GP de Italia', 'Mugello, Italia'],
  ['MotoGP', '2027-06-13', 'GP de Cataluña', 'Circuit de Barcelona-Catalunya, España'],
  ['MotoGP', '2027-06-27', 'GP de los Países Bajos', 'Assen, Países Bajos'],
  ['MotoGP', '2027-07-11', 'GP de Alemania', 'Sachsenring, Alemania'],
  ['MotoGP', '2027-07-18', 'GP de Chequia', 'Brno, Chequia'],
  ['MotoGP', '2027-08-15', 'GP de Gran Bretaña', 'Silverstone, Reino Unido'],
  ['MotoGP', '2027-10-17', 'GP de Japón', 'Motegi, Japón'],
  ['MotoGP', '2027-10-24', 'GP de Malasia', 'Sepang, Malasia'],
  ['MotoGP', '2027-10-31', 'GP de Indonesia', 'Mandalika, Lombok, Indonesia'],
  ['MotoGP', '2027-11-14', 'GP de Australia', 'Adelaide Street Circuit, Australia'],
  ['MotoGP', '2027-11-28', 'GP de Valencia', 'Circuit Ricardo Tormo, Cheste, España'],
  // WRC (fecha = primer día del rally; el rango va en el título)
  ['WRC', '2027-01-21', 'Rallye Monte-Carlo (21-24 ene)', 'Mónaco'],
  ['WRC', '2027-02-18', 'Rally de Suecia (18-21 feb)', 'Suecia'],
  ['WRC', '2027-03-18', 'Safari Rally Kenia (18-21 mar)', 'Naivasha, Kenia'],
  ['WRC', '2027-04-08', 'Rally de Croacia (8-11 abr)', 'Croacia'],
  ['WRC', '2027-05-06', 'Rally Islas Canarias (6-9 may)', 'Islas Canarias, España'],
  ['WRC', '2027-06-03', 'Rally de Japón (3-6 jun)', 'Japón'],
  ['WRC', '2027-06-24', 'Acropolis Rally Grecia (24-27 jun)', 'Grecia'],
  ['WRC', '2027-07-08', "Rally d'Italia (8-11 jul)", 'Italia'],
  ['WRC', '2027-08-26', 'Rally US (26-29 ago)', 'EE. UU.'],
  ['WRC', '2027-11-04', 'Rally de Chile (4-7 nov)', 'Chile'],
  ['WRC', '2027-11-25', 'Rally de Arabia Saudí (25-28 nov)', 'Arabia Saudí'],
  // WEC (día de la carrera; Le Mans = inicio de las 24 h)
  ['WEC', '2027-03-27', 'Qatar 1812 km', 'Lusail International Circuit, Qatar'],
  ['WEC', '2027-04-11', '6 Horas de Imola', 'Autodromo Enzo e Dino Ferrari, Italia'],
  ['WEC', '2027-04-25', '6 Horas de Silverstone', 'Silverstone, Reino Unido'],
  ['WEC', '2027-05-15', '6 Horas de Spa-Francorchamps', 'Spa-Francorchamps, Bélgica'],
  ['WEC', '2027-06-12', '24 Horas de Le Mans (12-13 jun)', 'Circuit de la Sarthe, Francia'],
  ['WEC', '2027-07-11', '6 Horas de São Paulo', 'Interlagos, Brasil'],
  ['WEC', '2027-09-12', 'Lone Star Le Mans', 'Circuit of the Americas, Austin, EE. UU.'],
  // GT World Challenge Europe (Monza queda fuera en 2027; entra Imola)
  ['GT', '2027-04-17', 'GTWC Europe – Paul Ricard 6H (16-18 abr)', 'Circuit Paul Ricard, Le Castellet, Francia'],
  ['GT', '2027-05-01', 'GTWC Europe – Brands Hatch Sprint (1-2 may)', 'Brands Hatch, Reino Unido'],
  ['GT', '2027-05-22', 'GTWC Europe – Imola 3H (21-23 may)', 'Autodromo Enzo e Dino Ferrari, Italia'],
  ['GT', '2027-06-26', '24 Horas de Spa (23-27 jun)', 'Spa-Francorchamps, Bélgica'],
  ['GT', '2027-07-17', 'GTWC Europe – Misano Sprint (16-18 jul)', 'Misano, Italia'],
  ['GT', '2027-07-31', 'GTWC Europe – Magny-Cours Sprint (30 jul-1 ago)', 'Magny-Cours, Francia'],
  ['GT', '2027-08-28', 'GTWC Europe – Nürburgring 3H (28-29 ago)', 'Nürburgring, Alemania'],
];

function staticEvents(series, year) {
  return STATIC_EVENTS.filter(([cat, ymd]) => cat === series.category && ymd.startsWith(`${year}-`)).map(
    ([, ymd, name, place], i) => ({
      id: `static-${series.slug}-${year}-${i}`,
      title: `${series.emoji} ${series.category}: ${name}`,
      category: series.category,
      tags: [series.category],
      type: 'motorsport',
      date: new Date(`${ymd}T12:00:00Z`).toISOString(),
      location: `${place} · hora por confirmar`,
    })
  );
}

async function getMotorsport(series) {
  try {
    const seasons = await Promise.all(MOTOR_SEASONS.map((y) => getRemoteSeason(series, y)));
    let events = [];
    const sources = [];
    MOTOR_SEASONS.forEach((year, i) => {
      if (seasons[i].length) {
        events = events.concat(seasons[i]);
        sources.push(`${year} remoto`);
      } else {
        const fallback = staticEvents(series, year); // respaldo solo para la temporada sin datos remotos
        events = events.concat(fallback);
        if (fallback.length) sources.push(`${year} respaldo`);
      }
    });
    return { events, diagnostics: [`${series.category}: ${events.length} eventos (${sources.join(', ') || 'sin datos'})`] };
  } catch (err) {
    console.warn(`[motor:${series.category}] ${err.message}`);
    const fallback = MOTOR_SEASONS.flatMap((y) => staticEvents(series, y));
    return { events: fallback, diagnostics: [`${series.category}: ${err.message} (respaldo)`] };
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

  const jobs = [...F1_SEASONS.map(getF1Season), ...MOTOR.map(getMotorsport), getFootball()];
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
