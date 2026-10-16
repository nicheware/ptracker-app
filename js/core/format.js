// @ts-check
// Display format tokens → strings, input-control text and small display helpers (CC-09, CD-4 §7).

import { round, toFixedString } from './numbers.js';
import { formatShortDate, formatLongDate, todayIso } from './dates.js';

/** The on-screen blank (U+2014 em dash, CC-09). */
export const BLANK = '—';

const MINUS = '−';

/**
 * Signed percentage at `dp` decimals: '+' above zero, U+2212 below, no sign at zero (after rounding).
 * @param {number|null} value
 * @param {number} dp
 * @returns {string}
 */
function signedPct(value, dp) {
  const r = round(value, dp);
  if (r === null) return BLANK;
  const sign = r > 0 ? '+' : r < 0 ? MINUS : '';
  return `${sign}${toFixedString(Math.abs(r), dp)}%`;
}

/**
 * Formats a value with a display token (CC-09). `null` (and `''` for text) gives BLANK for every token;
 * an unknown token throws (a programming error).
 * @param {number|string|null|undefined} value
 * @param {string} token  int | dec1 | pct1Signed | pct0Signed | ml | text | date | dateLong | weekday
 * @returns {string}
 */
export function formatValue(value, token) {
  switch (token) {
    case 'int':
      return value == null ? BLANK : String(value);
    case 'dec1': {
      const s = toFixedString(/** @type {number|null} */ (value ?? null), 1);
      return s === null ? BLANK : s.replace('-', MINUS);
    }
    case 'pct1Signed':
      return signedPct(/** @type {number|null} */ (value ?? null), 1);
    case 'pct0Signed':
      return signedPct(/** @type {number|null} */ (value ?? null), 0);
    case 'ml':
      return value == null ? BLANK : `${String(value)} ml`;
    case 'text':
      return value == null || value === '' ? BLANK : String(value);
    case 'date':
      return value == null ? BLANK : formatShortDate(String(value));
    case 'dateLong':
      return value == null ? BLANK : formatLongDate(String(value));
    case 'weekday':
      return value == null ? BLANK : String(value);
    default:
      throw new Error(`formatValue: unknown token "${token}"`);
  }
}

/**
 * Text for a numeric input control (CC-09 rev 1): null → '', number → String(x) (full precision),
 * string → as is.
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function toInputText(value) {
  if (value == null) return '';
  return typeof value === 'number' ? String(value) : value;
}

/**
 * The local calendar date of a UTC Timestamp, as d-MMM-yy; BLANK for null or an invalid timestamp.
 * @param {string|null} ts
 * @returns {string}
 */
export function formatTimestampDate(ts) {
  if (ts == null) return BLANK;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return BLANK;
  return formatShortDate(todayIso(new Date(ms)));
}

/**
 * Display label of a tag kind: 'treatment' → 'Treatment'.
 * @param {string} kind
 * @returns {string}
 */
export function kindLabel(kind) {
  const k = String(kind ?? '');
  return k === '' ? '' : k[0].toUpperCase() + k.slice(1);
}

/** Short tag-kind names for tight rows (FR-TAG-07). */
const KIND_SHORT = Object.freeze({ treatment: 'Treat', positive: 'Pos', event: 'Event' });

/**
 * Short display name of a tag kind: 'treatment' → 'Treat', 'positive' → 'Pos', 'event' → 'Event'; other kinds fall
 * back to kindLabel.
 * @param {string} kind
 * @returns {string}
 */
export function kindShortLabel(kind) {
  return Object.hasOwn(KIND_SHORT, kind) ? KIND_SHORT[/** @type {keyof typeof KIND_SHORT} */ (kind)] : kindLabel(kind);
}

/** Tag-kind glyphs, always shown beside text (FR-TAG-05, NFR-USE-04; CD-4 §6.5). */
const KIND_GLYPHS = Object.freeze({ treatment: '▲', positive: '★', event: '●' });

/**
 * Glyph of a tag kind: 'treatment' → '▲', 'positive' → '★', 'event' → '●'; '' for other kinds.
 * @param {string} kind
 * @returns {string}
 */
export function kindGlyph(kind) {
  return Object.hasOwn(KIND_GLYPHS, kind) ? KIND_GLYPHS[/** @type {keyof typeof KIND_GLYPHS} */ (kind)] : '';
}
