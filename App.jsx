import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';

const FILTERS = [
  { key: 'TODOS', test: () => true },
  { key: 'MOTORSPORT', test: (e) => e.type === 'motorsport' },
  { key: 'FÚTBOL', test: (e) => e.type === 'futbol' },
  { key: 'F1', test: (e) => e.tags.includes('F1') },
  { key: 'MotoGP', test: (e) => e.tags.includes('MotoGP') },
  { key: 'WRC', test: (e) => e.tags.includes('WRC') },
  { key: 'WEC', test: (e) => e.tags.includes('WEC') },
  { key: 'GT', test: (e) => e.tags.includes('GT') },
  { key: 'Champions', test: (e) => e.tags.includes('Champions') },
  { key: 'FC Barcelona', test: (e) => e.tags.includes('FC Barcelona') },
  { key: 'Real Madrid', test: (e) => e.tags.includes('Real Madrid') },
  { key: 'RC Deportivo', test: (e) => e.tags.includes('RC Deportivo') },
];

const STYLE = {
  F1: { emoji: '🏎️', badge: 'bg-red-500/15 text-red-300 border-red-500/30' },
  MotoGP: { emoji: '🏍️', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  WRC: { emoji: '🚗', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  WEC: { emoji: '🏁', badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  GT: { emoji: '🚘', badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  'FC Barcelona': { emoji: '🔵🔴', badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  'Real Madrid': { emoji: '⚪', badge: 'bg-amber-400/15 text-amber-200 border-amber-400/30' },
  'RC Deportivo': { emoji: '🔵⚪', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  'Champions League': { emoji: '⭐', badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
};
const styleOf = (c) => STYLE[c] || { emoji: '📅', badge: 'bg-slate-700/40 text-slate-300 border-slate-600' };

const fmtDay = (d) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }).replace('.', '');
const fmtWeekday = (d) => new Date(d).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
const fmtTime = (d) => new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function exportIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda Deportiva 2026//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Agenda Deportiva 2026'];
  for (const e of events) {
    const hours = e.type === 'futbol' ? 2 : 1;
    const end = new Date(new Date(e.date).getTime() + hours * 3600 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(e.id)}@agenda-deportiva`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(e.date)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(`${styleOf(e.category).emoji} ${e.title}`)}`,
      `LOCATION:${icsText(e.location)}`,
      `CATEGORIES:${icsText(e.category)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agenda-deportiva-2026.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('TODOS');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/deportes');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      setEvents(data.events);
      setWarnings(data.warnings || []);
    } catch (e) {
      setError('No se pudo cargar la agenda. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    return events.filter(f.test);
  }, [events, filter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-24" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-4 pb-3 pt-4 backdrop-blur" style={{ top: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight">
              Agenda <span className="text-amber-400">Deportiva</span> 2026
            </h1>
            <button onClick={load} disabled={loading} aria-label="Recargar" className="rounded-full border border-slate-700 bg-slate-900 p-2 text-blue-400 active:scale-95 disabled:opacity-60">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <nav className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  filter === f.key ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                {f.key}
              </button>
            ))}
          </nav>
        </header>

        <main className="flex-1 space-y-3 px-4 pt-4">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
          )}
          {warnings.length > 0 && !loading && (
            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Algunas fuentes no respondieron: {warnings.join(' · ')}</span>
            </div>
          )}
          {loading && events.length === 0 &&
            [...Array(5)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-900" />)}
          {!loading && !error && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">No hay eventos próximos para este filtro.</p>
          )}

          {visible.map((e) => {
            const s = styleOf(e.category);
            return (
              <article key={e.id} className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-950 py-2">
                  <span className="text-[10px] uppercase text-slate-500">{fmtWeekday(e.date)}</span>
                  <span className="text-sm font-bold uppercase text-amber-400">{fmtDay(e.date)}</span>
                  <span className="text-xs font-semibold text-blue-300">{fmtTime(e.date)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.badge}`}>{e.category}</span>
                  <h2 className="mt-1 text-sm font-semibold leading-snug">
                    <span className="mr-1">{s.emoji}</span>
                    {e.title}
                  </h2>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate">{e.location}</span>
                  </p>
                </div>
              </article>
            );
          })}
        </main>

        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent px-4 pt-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          <button
            onClick={() => exportIcs(visible)}
            disabled={visible.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-3 text-sm font-bold text-slate-950 shadow-lg active:scale-[.98] disabled:opacity-40"
          >
            <CalendarPlus size={18} /> Exportar {visible.length} eventos (.ics)
          </button>
        </div>
      </div>
    </div>
  );
}
