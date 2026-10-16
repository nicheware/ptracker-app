// @ts-check
// Nevro entry metrics, day badges and History columns (CD-3 §12).

import { isNum, round } from '../../core/numbers.js';
import { FRAMEWORK_HISTORY, FRAMEWORK_METRICS } from '../../core/columns.js';
import { PROGRAM_OFF, UNKNOWN_LABEL } from './constants.js';
import { programLabel } from './programs.js';
import { formatCommentDisplay } from './comment.js';

/** @typedef {import('../../core/types.js').ColumnContext} ColumnContext */
/** @typedef {import('../../core/types.js').MetricDescriptor} MetricDescriptor */
/** @typedef {import('../../core/types.js').ColumnDescriptor} ColumnDescriptor */
/** @typedef {import('../../core/types.js').CategoryBadge} CategoryBadge */
/** @typedef {import('../../core/types.js').Tone} Tone */

/** @param {ColumnContext} ctx @returns {Object<string, any>} */
export const ns = (ctx) => ctx?.record?.category?.nevro ?? {};
/** @param {ColumnContext} ctx @returns {Object<string, any>} */
export const nd = (ctx) => ctx?.derived?.category?.nevro ?? {};
/** @param {ColumnContext} ctx @returns {Object<string, any>} */
export const nh = (ctx) => ctx?.history?.nevro ?? {};

/** @param {unknown} v @returns {number|null} */
const numOrNull = (v) => (isNum(v) ? v : null);

/**
 * THC for display, statistics and CSV: 0 and null both mean none (CC-22 rev 1).
 * @param {unknown} v
 * @returns {number|null}
 */
export const thcValue = (v) => (isNum(v) && v > 0 ? v : null);

/**
 * 'relief' / 'worse' / 'no change', judged on the displayed 1 dp value; null for blank (CD-3 §12.1).
 * @param {number|null} pct
 * @returns {string|null}
 */
export function reliefWord(pct) {
  const r = round(pct, 1);
  if (r === null) return null;
  return r > 0 ? 'relief' : r < 0 ? 'worse' : 'no change';
}

/** @param {number|null} npl */
const nplOutOfRange = (npl) => {
  const r = round(npl, 1);
  return r !== null && (r < 0 || r > 10);
};

/** @param {ColumnContext} ctx @returns {string|null} */
const activeOf = (ctx) => {
  const p = nh(ctx).activeProgram;
  return typeof p === 'string' ? p : null;
};

/** @type {MetricDescriptor[]} */
export const displayMetrics = [
  FRAMEWORK_METRICS.average,
  { id: 'pct', label: 'Nevro relief %', get: (ctx) => numOrNull(nd(ctx).pct), format: 'pct1Signed',
    note: (ctx) => reliefWord(numOrNull(nd(ctx).pct)), prominent: true, group: 'results' },
  { id: 'npl', label: 'Nevro pain level', get: (ctx) => numOrNull(nd(ctx).npl), format: 'dec1',
    note: (ctx) => (nplOutOfRange(numOrNull(nd(ctx).npl)) ? 'Outside the 0–10 scale' : null),
    tone: (ctx) => (nplOutOfRange(numOrNull(nd(ctx).npl)) ? 'warning' : null), prominent: true, group: 'results' },
  // M2: the 'rollingAvg' metric (Rolling avg (7 records), pct1Signed, note 'partial' + tone 'muted').
  { id: 'activeProgram', label: 'Active today', get: activeOf, format: 'text', blankText: UNKNOWN_LABEL,
    note: (ctx) => (activeOf(ctx) === PROGRAM_OFF ? 'Stimulator off' : null),
    tone: (ctx) => (activeOf(ctx) === PROGRAM_OFF ? 'off' : null), group: 'context' },
];

/**
 * Short status badges for the entry header and History row (CD-3 §12.2).
 * @param {ColumnContext} ctx
 * @returns {CategoryBadge[]}
 */
export function dayBadges(ctx) {
  /** @type {CategoryBadge[]} */
  const badges = [];
  if (activeOf(ctx) === PROGRAM_OFF) badges.push({ id: 'off', text: 'Stimulator off', tone: 'warning' });
  const pc = ns(ctx).programChange;
  if (typeof pc === 'string') badges.push({ id: 'change', text: '→ ' + programLabel(pc) + ' tonight', tone: 'info' });
  return badges;
}

/** History 'Program' column, reused by the M2 chart detail panel (CD-3 §12.3, §15). @type {ColumnDescriptor} */
export const programColumn = {
  id: 'program', label: 'Program', get: activeOf, format: 'text', defaultHidden: true, blankText: UNKNOWN_LABEL,
  tone: (ctx) => (activeOf(ctx) === PROGRAM_OFF ? 'off' : null),
};

const F = FRAMEWORK_HISTORY;

/** A rolling value that exists but has fewer than 7 records or spans a gap (NV-CAL-08). @param {ColumnContext} ctx */
const rollingPartial = (ctx) => isNum(nh(ctx).rollingAvg) && nh(ctx).rollingPartial === true;

/** NV-HIS-01 order, then Program (CD-3 §12.3). Default-visible: Average, Nevro Percent, Rolling avg (NV-HIS-04). @type {ColumnDescriptor[]} */
export const historyColumns = [
  F.day,
  F.date,
  F.morning,
  F.afternoon,
  F.evening,
  { id: 'thcMorning', label: 'MornTHC', get: (ctx) => thcValue(ns(ctx).thcMorning), format: 'ml', defaultHidden: true },
  F.other,
  F.average,
  { id: 'comment', label: 'Comment', get: (ctx) => formatCommentDisplay(ns(ctx).programChange ?? null, ctx?.record?.comment),
    format: 'text', defaultHidden: true },
  F.baseline,
  { id: 'npl', label: 'Nevro pain level', get: (ctx) => numOrNull(nd(ctx).npl), format: 'dec1', defaultHidden: true,
    tone: (ctx) => (nplOutOfRange(numOrNull(nd(ctx).npl)) ? 'warning' : null) },
  { id: 'pct', label: 'Nevro Percent', shortLabel: 'Nevro %', get: (ctx) => numOrNull(nd(ctx).pct), format: 'pct1Signed' },
  { id: 'rollingAvg', label: 'Rolling avg', shortLabel: 'Roll avg', get: (ctx) => numOrNull(nh(ctx).rollingAvg), format: 'pct1Signed',
    note: (ctx) => (rollingPartial(ctx) ? 'partial' : null), tone: (ctx) => (rollingPartial(ctx) ? 'muted' : null) },
  programColumn,
];
