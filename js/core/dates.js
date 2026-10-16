// @ts-check
// ISO calendar-date helpers, weekday codes and the fixed English date formats (CC-07, CD-2 §4).

/** @typedef {import('./types.js').IsoDate} IsoDate */
/** @typedef {import('./types.js').WeekdayCode} WeekdayCode */

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;

/** Monday-first weekday codes (FR-DATA-03). */
export const WEEKDAYS = Object.freeze(/** @type {WeekdayCode[]} */ (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));

/** English month abbreviations (CC-07 rev 1). */
export const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']);

const WEEKDAY_NAMES = Object.freeze({
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
});

/** @param {number} n @param {number} width */
const pad = (n, width) => String(n).padStart(width, '0');

/**
 * UTC milliseconds of a calendar date; setUTCFullYear keeps years below 100 unshifted.
 * @param {number} y @param {number} m 1-based month @param {number} d
 */
function utcMsOf(y, m, d) {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getTime();
}

/** @param {number} ms @returns {IsoDate} */
function isoFromUtcMs(ms) {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** @param {IsoDate} d @returns {{y: number, m: number, d: number}} */
function partsOf(d) {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, d: day };
}

/** @param {IsoDate} d */
function utcMs(d) {
  const p = partsOf(d);
  return utcMsOf(p.y, p.m, p.d);
}

/**
 * True for a real calendar date written `YYYY-MM-DD` (year 1000–9999).
 * @param {unknown} s
 * @returns {s is IsoDate}
 */
export function isIsoDate(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1000 || mo < 1 || mo > 12 || d < 1) return false;
  return isoFromUtcMs(utcMsOf(y, mo, d)) === s;
}

/**
 * The local calendar date of `now`: the only use of local time fields (CC-07).
 * @param {Date} now
 * @returns {IsoDate}
 */
export function todayIso(now) {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/**
 * @param {IsoDate} d
 * @returns {WeekdayCode}
 */
export function weekdayOf(d) {
  return WEEKDAYS[(new Date(utcMs(d)).getUTCDay() + 6) % 7];
}

/**
 * @param {IsoDate} d
 * @param {number} n  whole days, may be negative
 * @returns {IsoDate}
 */
export function addDays(d, n) {
  return isoFromUtcMs(utcMs(d) + n * DAY_MS);
}

/**
 * `b − a` in whole days.
 * @param {IsoDate} a
 * @param {IsoDate} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/**
 * `d-MMM-yy` without a leading zero, e.g. `1-Aug-26`; `''` for an invalid date.
 * @param {IsoDate} d
 * @returns {string}
 */
export function formatShortDate(d) {
  if (!isIsoDate(d)) return '';
  const p = partsOf(d);
  return `${p.d}-${MONTHS[p.m - 1]}-${pad(p.y % 100, 2)}`;
}

/**
 * Long day-first form, e.g. `Friday 17 July 2026`; `''` for an invalid date.
 * @param {IsoDate} d
 * @returns {string}
 */
export function formatLongDate(d) {
  if (!isIsoDate(d)) return '';
  const p = partsOf(d);
  return `${weekdayName(weekdayOf(d))} ${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}`;
}

/**
 * Full English weekday name, e.g. `Monday`; `''` for an unknown code.
 * @param {WeekdayCode} code
 * @returns {string}
 */
export function weekdayName(code) {
  return Object.hasOwn(WEEKDAY_NAMES, code) ? WEEKDAY_NAMES[code] : '';
}

/**
 * Parses `d-MMM-yy` (month case-insensitive, year 20yy).
 * @param {string} s
 * @returns {IsoDate|null}
 */
export function parseShortDate(s) {
  if (typeof s !== 'string') return null;
  const m = SHORT_RE.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === m[2].toLowerCase());
  if (month < 0) return null;
  const iso = `${2000 + Number(m[3])}-${pad(month + 1, 2)}-${pad(Number(m[1]), 2)}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * ISO or `d-MMM-yy` (FR-IMP-03).
 * @param {string} s
 * @returns {IsoDate|null}
 */
export function parseDateFlexible(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return isIsoDate(t) ? t : parseShortDate(t);
}
