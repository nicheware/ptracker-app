// @ts-check
// Nevro program logic: normalising, labels, known programs, active program per record, rename (CD-3 §9).

import { latestBefore } from '../../core/engine.js';
import { PROGRAM_OFF, UNKNOWN_LABEL } from './constants.js';

/** @typedef {import('../../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../../core/types.js').IsoDate} IsoDate */

/**
 * The record's programChange, or null for a missing namespace or non-string value.
 * @param {DayRecord} r
 * @returns {string|null}
 */
const changeOf = (r) => {
  const pc = r?.category?.nevro?.programChange;
  return typeof pc === 'string' && pc !== '' ? pc : null;
};

/**
 * Trim; '' → null; case-insensitive 'off' → PROGRAM_OFF. Used by import and rename (entry uses the combo rule).
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function normaliseProgram(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (t === '') return null;
  return t.toLowerCase() === 'off' ? PROGRAM_OFF : t;
}

/**
 * Display label: null → 'Unknown', else the value itself ('Off', 'KM8').
 * @param {string|null|undefined} p
 * @returns {string}
 */
export function programLabel(p) {
  return p == null ? UNKNOWN_LABEL : p;
}

/**
 * Distinct program names (excluding Off), most recently used first (NV-PRG-01, NV-PRG-04).
 * @param {DayRecord[]} records  ascending
 * @returns {string[]}
 */
export function knownPrograms(records) {
  /** @type {string[]} */
  const out = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const pc = changeOf(records[i]);
    if (pc !== null && pc !== PROGRAM_OFF && !out.includes(pc)) out.push(pc);
  }
  return out;
}

/**
 * Ascending list of { date, program } for every record with a programChange.
 * @param {DayRecord[]} records
 * @returns {Array<{ date: IsoDate, program: string }>}
 */
export function programChanges(records) {
  /** @type {Array<{ date: IsoDate, program: string }>} */
  const out = [];
  for (const r of records) {
    const pc = changeOf(r);
    if (pc !== null) out.push({ date: r.date, program: pc });
  }
  return out;
}

/**
 * Active program per record, aligned with records: the latest change strictly before (NV-PRG-02/03).
 * @param {DayRecord[]} records  ascending
 * @returns {Array<string|null>}
 */
export const activePrograms = (records) => latestBefore(records, changeOf);

/**
 * NV-PRG-06: records whose programChange === from, rewritten to `to`; others are left out. Pure (CC-06);
 * timestamps are left for the record service.
 * @param {DayRecord[]} records
 * @param {string} from
 * @param {string} to   normalised, valid program name
 * @returns {DayRecord[]}
 */
export function renameProgram(records, from, to) {
  return records
    .filter((r) => r?.category?.nevro?.programChange === from)
    .map((r) => ({ ...r, category: { ...r.category, nevro: { ...r.category.nevro, programChange: to } } }));
}
