// @ts-check
// Nevro CSV column lists: the 16-column standard layout ending Rolling avg; the extended layout is M2 (CD-3 §13).

import { isNum } from '../../core/numbers.js';
import { FRAMEWORK_CSV } from '../../core/columns.js';
import { formatCommentCell } from './comment.js';
import { nd, nh, ns, thcValue } from './display.js';

/** @typedef {import('../../core/types.js').CsvColumn} CsvColumn */

/** @param {unknown} v @returns {number|null} */
const numOrNull = (v) => (isNum(v) ? v : null);

const F = FRAMEWORK_CSV;

/**
 * NV-CSV-01, NV-CAL-08 (D-6): the rolling mean of the unrounded pct, a bare 1 dp number, empty when null; partial
 * values carry no marker in the CSV (CD-3 §13.1). The same column object ends the extended layout (M2).
 * @type {CsvColumn}
 */
const rollingAvg = { header: 'Rolling avg', get: (ctx) => numOrNull(nh(ctx).rollingAvg), format: 'dec1' };

/** NV-CSV-01, NV-CSV-02, NV-CSV-04: headers byte for byte, columns 14–15 the app's own, then Rolling avg. @type {CsvColumn[]} */
export const csvStandard = [
  F.day,
  F.date,
  F.morning,
  F.afternoon,
  F.evening,
  { header: 'MornTHC', get: (ctx) => thcValue(ns(ctx).thcMorning), format: 'num' },
  { header: 'AfterTHC', get: (ctx) => thcValue(ns(ctx).thcAfternoon), format: 'num' },
  F.other,
  F.average,
  F.low,
  F.high,
  { header: 'Comment', get: (ctx) => formatCommentCell(ns(ctx).programChange ?? null, ctx?.record?.comment), format: 'text' },
  F.baseline,
  { header: 'Nevro pain level', get: (ctx) => numOrNull(nd(ctx).npl), format: 'dec1' },
  { header: 'Nevro Percent', get: (ctx) => numOrNull(nd(ctx).pct), format: 'dec1' },
  rollingAvg,
];

/** NV-CSV-05 (M2): [...csvStandard.slice(0, 15), 'Other (copy)', rollingAvg]; empty until M2 (CC-20 rev 1). @type {CsvColumn[]} */
export const csvExtended = [];
