// @ts-check
// Number predicates, the one rounding function, decimal parsing and means (CC-08, CD-2 §3).

const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * True for finite numbers only.
 * @param {unknown} x
 * @returns {x is number}
 */
export function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * An integer score from 0 to 10 (A-01).
 * @param {unknown} x
 * @returns {boolean}
 */
export function isScore(x) {
  return Number.isInteger(x) && /** @type {number} */ (x) >= 0 && /** @type {number} */ (x) <= 10;
}

/**
 * Round half away from zero (FR-CAL-04, A-08). Strips binary noise with toPrecision(15) first, as a
 * spreadsheet does, so 1.45 → 1.5. Returns null for null or non-finite input; never returns -0.
 * @param {number|null} x
 * @param {number} [dp=1]
 * @returns {number|null}
 */
export function round(x, dp = 1) {
  if (!isNum(x)) return null;
  const sign = x < 0 ? -1 : 1;
  const scaled = Number((Math.abs(x) * 10 ** dp).toPrecision(15));
  const r = (sign * Math.round(scaled)) / 10 ** dp;
  return r === 0 ? 0 : r;
}

/**
 * round() then toFixed(dp): ASCII '-' for negatives, never '-0.0'; null for blank.
 * @param {number|null} x
 * @param {number} [dp=1]
 * @returns {string|null}
 */
export function toFixedString(x, dp = 1) {
  const r = round(x, dp);
  return r === null ? null : r.toFixed(dp);
}

/**
 * Parses a user-typed decimal (CC-08 rev 1): '' or whitespace → null; '0.4', '.5', '7', '7.', '+2', '-0.4'
 * → number ('-0' → 0); anything else (exponent, comma, thousands separator, junk) → NaN.
 * @param {string|null} text
 * @returns {number|null}
 */
export function parseDecimal(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (t === '') return null;
  if (!DECIMAL_RE.test(t)) return NaN;
  const n = Number(t);
  return n === 0 ? 0 : n;
}

/**
 * Digits after the '.' in a decimal string accepted by parseDecimal ('0.40' → 2, '7' → 0).
 * @param {string|null} text
 * @returns {number}
 */
export function countDp(text) {
  const t = String(text ?? '').trim();
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}

/**
 * Left-to-right sum divided once by the count (PR-5). Callers pass numbers only. Empty → null.
 * @param {number[]} values
 * @returns {number|null}
 */
export function mean(values) {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Finite number → itself (with -0 → 0); anything else → null (PR-7).
 * @param {unknown} x
 * @returns {number|null}
 */
export function sanitiseNumber(x) {
  if (!isNum(x)) return null;
  return x === 0 ? 0 : x;
}
