// @ts-check
// Nevro formulas: relief %, Nevro pain level, per-record metrics and history metrics (CD-3 §10, §11).

import { isNum } from '../../core/numbers.js';
import { trailingMean } from '../../core/engine.js';
import { ROLLING_WINDOW } from './constants.js';
import { activePrograms } from './programs.js';

/** @typedef {import('../../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../../core/types.js').Derived} Derived */
/** @typedef {import('../../core/types.js').FrameworkDerived} FrameworkDerived */

export const DERIVED_KEYS = Object.freeze(['pct', 'npl']);                                   // nevro.derivedKeys
export const HISTORY_KEYS = Object.freeze(['activeProgram', 'rollingAvg', 'rollingPartial']);  // nevro.historyKeys

/**
 * NV-CAL-01/02. Exactly this operation order (CC-08 rev 1); null unless avg and b are numbers and b > 0.
 * @param {number|null} avg
 * @param {number|null} b
 * @returns {number|null}
 */
export function reliefPercent(avg, b) {
  if (!isNum(avg) || !isNum(b) || b <= 0) return null;
  return (b - avg) / b * 100;
}

/**
 * NV-CAL-03. Uses the unrounded pct; not clamped (OQ-02).
 * @param {number|null} pct
 * @param {number|null} R  reference level snapshot
 * @returns {number|null}
 */
export function nevroPainLevel(pct, R) {
  if (!isNum(pct) || !isNum(R)) return null;
  return R * (1 - pct / 100);
}

/**
 * CC-18 hook. Always returns exactly DERIVED_KEYS; never throws.
 * @param {DayRecord} record
 * @param {FrameworkDerived} base
 * @returns {{ pct: number|null, npl: number|null }}
 */
export function deriveRecord(record, base) {
  const ns = record?.category?.nevro;
  const pct = base?.complete ? reliefPercent(base.average, record?.baseline ?? null) : null;
  const npl = nevroPainLevel(pct, ns?.referenceLevel ?? null);
  return { pct, npl };
}

/**
 * NV-CAL-08 through the engine helper trailingMean (CC-19 rev 1, CD-2 §6.4).
 * @param {DayRecord[]} records
 * @param {Derived[]} deriveds
 * @returns {Array<{ rollingAvg: number|null, rollingPartial: boolean }>}
 */
export function rollingAverages(records, deriveds) {
  const pcts = deriveds.map((d) => {
    const pct = d?.category?.nevro?.pct;
    return isNum(pct) ? pct : null;
  });
  return trailingMean(records.map((r) => r.date), pcts, { size: ROLLING_WINDOW, maxSpanDays: ROLLING_WINDOW })
    .map((w) => ({ rollingAvg: w.value, rollingPartial: w.partial }));
}

/**
 * Causal history metrics, aligned with records (CC-19 rev 1).
 * @param {DayRecord[]} records  ascending, complete and incomplete
 * @param {Derived[]} deriveds   deriveAll(records, nevro)
 * @returns {Array<{ activeProgram: string|null, rollingAvg: number|null, rollingPartial: boolean }>}
 */
export function historyMetrics(records, deriveds) {
  const active = activePrograms(records);
  const rolling = rollingAverages(records, deriveds);
  return records.map((_, i) => ({ activeProgram: active[i], ...rolling[i] }));
}
