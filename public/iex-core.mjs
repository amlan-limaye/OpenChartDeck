export const SYMBOLS = ['DRAM', 'CRWV', 'MAGS', 'AAPL', 'ORCL', 'SOXX', 'META', 'BOT'];
export const NAMES = { DRAM: 'Roundhill Memory ETF', CRWV: 'CoreWeave', MAGS: 'Magnificent Seven ETF', AAPL: 'Apple', ORCL: 'Oracle', SOXX: 'iShares Semiconductor ETF', META: 'Meta Platforms', BOT: 'RoboStrategy' };
export const STORE_KEY = 'ai-daily-overview:v1';
export const DEFAULT_PREFS = { version: 1, order: SYMBOLS, range: '3M', sma: true, volume: true, sync: true, ranges: {} };
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function sessionDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid session date');
    return value;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid bar timestamp');
  return nyDate.format(date);
}
export function normalizeBar(raw) {
  const time = sessionDate(raw.t ?? raw.time);
  const bar = { time, open: raw.o ?? raw.open, high: raw.h ?? raw.high, low: raw.l ?? raw.low, close: raw.c ?? raw.close, volume: raw.v ?? raw.volume };
  if (!['open', 'high', 'low', 'close', 'volume'].every(k => typeof bar[k] === 'number' && Number.isFinite(bar[k]))) throw new Error('Non-numeric OHLCV');
  if (Math.min(bar.open, bar.close, bar.low) <= 0 || bar.volume < 0 || !Number.isInteger(bar.volume) || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) throw new Error('Invalid OHLCV bounds');
  return bar;
}
export function normalizeBars(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid bars response');
  const byDate = new Map();
  for (const raw of rows) { const bar = normalizeBar(raw); byDate.set(bar.time, bar); }
  return [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
}
export function upsertBar(bars, raw) {
  const bar = normalizeBar(raw);
  // Daily stream messages are cumulative snapshots. Replace; never add volume.
  return normalizeBars([...bars, bar]);
}
export function sma(bars, period = 20) {
  if (!Number.isInteger(period) || period < 1) throw new Error('Invalid SMA period');
  let sum = 0;
  return bars.flatMap((bar, i) => {
    sum += bar.close;
    if (i >= period) sum -= bars[i - period].close;
    return i >= period - 1 ? [{ time: bar.time, value: sum / period }] : [];
  });
}
// Official NYSE calendar, verified 2026-10-23. Outside this range, status is unknown.
const holidays = new Set([
  '2025-01-01','2025-01-09','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
  '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25'
]);
const earlyCloses = new Set(['2025-07-03','2025-11-28','2025-12-24','2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
export function isSession(day) {
  const date = new Date(day + 'T12:00:00Z');
  return date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(day);
}
export function sessionState(now = Date.now()) {
  const date = sessionDate(now);
  if (+date.slice(0, 4) < 2025 || +date.slice(0, 4) > 2028) return { date, phase: 'unknown', expectedUpdates: false };
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const minute = Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
  const close = earlyCloses.has(date) ? 780 : 960;
  const open = isSession(date) && minute >= 570 && minute < close;
  return { date, phase: open ? 'open' : 'closed', expectedUpdates: open && minute >= 573, closeMinute: close };
}
export function sessionsBetween(first, last) {
  if (!first || !last) return [];
  const result = [];
  const date = new Date(first + 'T12:00:00Z');
  for (let i = 0; i < 2000 && date.toISOString().slice(0, 10) <= last; i++, date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    if (isSession(day)) result.push(day);
  }
  return result;
}
export function missingSessions(bars) {
  const present = new Set(bars.map(b => b.time));
  return sessionsBetween(bars[0]?.time, bars.at(-1)?.time).filter(d => !present.has(d));
}
export function withWhitespace(bars, timeline) {
  const map = new Map(bars.map(b => [b.time, b]));
  return timeline.map(time => map.get(time) ?? { time });
}
export function freshness({ mode, connection, lastReceived, connectedAt, now = Date.now() }) {
  if (mode === 'history') return 'history';
  if (connection !== 'connected') return connection;
  const session = sessionState(now);
  if (session.phase === 'unknown') return 'calendar-unknown';
  if (!session.expectedUpdates) return session.phase === 'open' ? 'waiting' : 'session-closed';
  if (lastReceived && sessionDate(lastReceived) === session.date && now - lastReceived <= 180000) return 'live';
  if (now - (connectedAt || 0) <= 180000) return 'waiting';
  return 'stale';
}
export function sanitizePrefs(value) {
  const p = value && typeof value === 'object' ? value : {};
  const order = Array.isArray(p.order) && p.order.length === SYMBOLS.length && new Set(p.order).size === SYMBOLS.length && p.order.every(s => SYMBOLS.includes(s)) ? p.order : [...SYMBOLS];
  const ranges = {};
  for (const [symbol, r] of Object.entries(p.ranges ?? {})) if (SYMBOLS.includes(symbol) && r && Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from && r.to - r.from < 5000 && r.from > -5000 && r.to < 5000) ranges[symbol] = { from: r.from, to: r.to };
  return { version: 1, order, range: ['1M','3M','6M','All'].includes(p.range) ? p.range : '3M', sma: typeof p.sma === 'boolean' ? p.sma : true, volume: typeof p.volume === 'boolean' ? p.volume : true, sync: typeof p.sync === 'boolean' ? p.sync : true, ranges };
}
export function readPrefs(storage) { try { return sanitizePrefs(JSON.parse(storage.getItem(STORE_KEY))); } catch { return sanitizePrefs({}); } }
export function savePrefs(storage, prefs) { try { storage.setItem(STORE_KEY, JSON.stringify(sanitizePrefs(prefs))); return true; } catch { return false; } }
export function chartRange(prefs, length, symbol, reset=false) {
  const saved=reset?undefined:prefs.ranges[symbol];
  const count=({'1M':22,'3M':64,'6M':126,All:length}[prefs.range]);
  return saved??{from:Math.max(0,length-count),to:length+3};
}
