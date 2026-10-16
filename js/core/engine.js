// @ts-check
// Calculation engine: derive, history metrics and generic helpers for categories (CC-18, CC-19, CD-2 §5–§6).

import { isScore, isNum, mean, sanitiseNumber } from './numbers.js';
import { daysBetween } from './dates.js';

/** @typedef {import('./types.js').DayRecord} DayRecord */
/** @typedef {import('./types.js').Derived} Derived */
/** @typedef {import('./types.js').FrameworkDerived} FrameworkDerived */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').HistoryValues} HistoryValues */
/** @typedef {import('./types.js').ColumnContext} ColumnContext */
/** @typedef {import('./types.js').WindowValue} WindowValue */
/** @typedef {import('./types.js').IsoDate} IsoDate */

export const SCORE_KEYS = Object.freeze(['morning', 'afternoon', 'evening']);

/** Category ids already warned about; console diagnostics only, never part of results (CD-2 §5.3). */
const warned = new Set();

/**
 * One console.warn per category per session.
 * @param {string} id
 * @param {unknown} e
 */
function logOnce(id, e) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`engine: category "${id}" deriveRecord failed; metrics blank`, e);
}

/**
 * Keeps exactly `keys` (or the output's own keys without them): finite numbers (−0 → 0), strings and booleans
 * pass; anything else becomes null (CC-18 rev 1).
 * @param {unknown} out
 * @param {readonly string[]|undefined} keys
 * @returns {Object<string, number|string|boolean|null>}
 */
function sanitiseMetrics(out, keys) {
  const src = out != null && typeof out === 'object' ? /** @type {Object<string, unknown>} */ (out) : {};
  const list = keys ?? Object.keys(src);
  /** @type {Object<string, number|string|boolean|null>} */
  const result = {};
  for (const key of list) {
    const v = src[key];
    result[key] = typeof v === 'number' ? sanitiseNumber(v)
      : (typeof v === 'string' || typeof v === 'boolean') ? v
        : null;
  }
  return result;
}

/** @param {Category} category */
function blankMetrics(category) {
  return Object.fromEntries((category.derivedKeys ?? []).map((k) => [k, null]));
}

/**
 * @param {Category} category
 * @param {DayRecord} record
 * @param {FrameworkDerived} base
 */
function callCategory(category, record, base) {
  if (typeof category.deriveRecord !== 'function') return blankMetrics(category);
  let out;
  try {
    out = category.deriveRecord(record, base);
  } catch (e) {
    logOnce(category.id, e);
    return blankMetrics(category);
  }
  return sanitiseMetrics(out, category.derivedKeys);
}

/**
 * Pure. Uses only the record and its snapshots. Never throws, never returns NaN/Infinity/undefined (CC-18).
 * @param {DayRecord} record
 * @param {Category} category
 * @returns {Derived}
 */
export function derive(record, category) {
  const s = SCORE_KEYS.map((k) => /** @type {any} */ (record)?.scores?.[k]);
  const ok = s.every(isScore);
  /** @type {FrameworkDerived} */
  const base = ok
    ? { complete: true, average: (s[0] + s[1] + s[2]) / 3, low: Math.min(s[0], s[1], s[2]), high: Math.max(s[0], s[1], s[2]) }
    : { complete: false, average: null, low: null, high: null };
  const catOut = callCategory(category, record, { ...base });
  return { ...base, category: { [category.id]: catOut } };
}

/**
 * derive() for each record, aligned with the input.
 * @param {DayRecord[]} records
 * @param {Category} category
 * @returns {Derived[]}
 */
export function deriveAll(records, category) {
  return records.map((r) => derive(r, category));
}

/**
 * Copy of record whose record.derived and record.category[id].derived equal derive(record). Timestamps and
 * inputs are unchanged; a record without the category namespace keeps its category object (CD-2 §5.4).
 * @param {DayRecord} record
 * @param {Category} category
 * @returns {DayRecord}
 */
export function withDerived(record, category) {
  const d = derive(record, category);
  const id = category.id;
  const ns = record.category?.[id];
  return {
    ...record,
    derived: { complete: d.complete, average: d.average, low: d.low, high: d.high },
    category: ns ? { ...record.category, [id]: { ...ns, derived: d.category[id] } } : record.category,
  };
}

/**
 * The stored copies on a record, assembled in the Derived shape (for the integrity pass, CC-18 rev 1).
 * @param {DayRecord} record
 * @param {Category} category
 * @returns {Derived}
 */
export function storedDerived(record, category) {
  const d = /** @type {any} */ (record)?.derived;
  return {
    complete: d?.complete === true,
    average: d?.average ?? null,
    low: d?.low ?? null,
    high: d?.high ?? null,
    category: { [category.id]: record?.category?.[category.id]?.derived ?? {} },
  };
}

/**
 * Exact comparison: framework values and the union of category keys, each with === (null equals null).
 * @param {Derived} a
 * @param {Derived} b
 * @returns {boolean}
 */
export function derivedEquals(a, b) {
  if (a.complete !== b.complete || a.average !== b.average || a.low !== b.low || a.high !== b.high) return false;
  const ids = new Set([...Object.keys(a.category ?? {}), ...Object.keys(b.category ?? {})]);
  for (const id of ids) {
    const x = a.category?.[id] ?? {};
    const y = b.category?.[id] ?? {};
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!(key in x) || !(key in y) || x[key] !== y[key]) return false;
    }
  }
  return true;
}

/**
 * Throws a programming error unless dates are strictly ascending.
 * @param {DayRecord[]} records
 */
function assertAscending(records) {
  for (let i = 1; i < records.length; i++) {
    if (!(records[i - 1].date < records[i].date)) {
      throw new Error(`historyMetrics: dates not strictly ascending at index ${i}`);
    }
  }
}

/**
 * History values for every record, aligned with records (CC-19). Records ascending, unique dates.
 * @param {DayRecord[]} records
 * @param {Derived[]} deriveds  deriveAll(records, category)
 * @param {Category} category
 * @returns {HistoryValues[]}
 */
export function historyMetrics(records, deriveds, category) {
  if (records.length !== deriveds.length) throw new Error('historyMetrics: records and deriveds differ in length');
  assertAscending(records);
  if (typeof category.historyMetrics !== 'function') return records.map(() => ({ [category.id]: {} }));
  const out = category.historyMetrics(records, deriveds);
  if (!Array.isArray(out) || out.length !== records.length) {
    throw new Error(`historyMetrics: category "${category.id}" returned the wrong length`);
  }
  return out.map((o) => ({ [category.id]: sanitiseMetrics(o, category.historyKeys) }));
}

/**
 * History values for one date over the prefix records[0..i] (needs causality, CC-19 rev 1); equal to
 * historyMetrics(...)[i]. Null if the date is not in records.
 * @param {IsoDate} date
 * @param {DayRecord[]} records
 * @param {Derived[]} deriveds
 * @param {Category} category
 * @returns {HistoryValues|null}
 */
export function historyAt(date, records, deriveds, category) {
  const i = records.findIndex((r) => r.date === date);
  if (i < 0) return null;
  return historyMetrics(records.slice(0, i + 1), deriveds.slice(0, i + 1), category)[i];
}

/**
 * deriveAll + historyMetrics zipped into ColumnContext rows, aligned with records (ascending).
 * @param {DayRecord[]} records
 * @param {Category} category
 * @returns {ColumnContext[]}
 */
export function buildContexts(records, category) {
  const deriveds = deriveAll(records, category);
  const history = historyMetrics(records, deriveds, category);
  return records.map((record, i) => ({ record, derived: deriveds[i], history: history[i] }));
}

/**
 * Carry-forward of the latest value strictly before each record: out[i] = pick(records[j], j) for the largest
 * j < i where that value is not null/undefined/''; else null (CD-2 §6.2).
 * @template T
 * @param {DayRecord[]} records
 * @param {(r: DayRecord, i: number) => T|null|undefined} pick
 * @returns {(T|null)[]}
 */
export function latestBefore(records, pick) {
  /** @type {T|null} */
  let last = null;
  /** @type {(T|null)[]} */
  const out = [];
  for (let i = 0; i < records.length; i++) {
    out.push(last);
    const v = pick(records[i], i);
    if (v != null && /** @type {unknown} */ (v) !== '') last = v;
  }
  return out;
}

/**
 * Trailing mean over the last `size` eligible (finite) values, ending at and including i (CD-2 §6.2).
 * @param {IsoDate[]} dates  ascending, aligned with values
 * @param {(number|null)[]} values
 * @param {{ size: number, maxSpanDays: number }} opts
 * @returns {WindowValue[]}
 */
export function trailingMean(dates, values, { size, maxSpanDays }) {
  /** @type {number[]} */
  const eligible = [];
  /** @type {WindowValue[]} */
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) {
      out.push({ value: null, count: 0, spanDays: 0, partial: false });
      continue;
    }
    eligible.push(i);
    const win = eligible.slice(-size);
    const value = mean(win.map((j) => /** @type {number} */ (values[j])));
    const spanDays = daysBetween(dates[win[0]], dates[i]) + 1;
    out.push({ value, count: win.length, spanDays, partial: win.length < size || spanDays > maxSpanDays });
  }
  return out;
}
