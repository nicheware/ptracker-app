// @ts-check
// Nevro CSV column lists: the 15-column standard layout; the extended layout is M2 (CD-3 §13).

import { isNum } from '../../core/numbers.js';
import { FRAMEWORK_CSV } from '../../core/columns.js';
import { formatCommentCell } from './comment.js';
import { nd, ns, thcValue } from './display.js';

/** @typedef {import('../../core/types.js').CsvColumn} CsvColumn */

/** @param {unknown} v @returns {number|null} */
const numOrNull = (v) => (isNum(v) ? v : null);

const F = FRAMEWORK_CSV;

/** NV-CSV-01, NV-CSV-02, NV-CSV-04: headers byte for byte, columns 14–15 the app's own. @type {CsvColumn[]} */
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
];

/** NV-CSV-05 (M2): [...csvStandard, 'Other (copy)', 'Rolling avg']; empty until M2 (CC-20 rev 1). @type {CsvColumn[]} */
export const csvExtended = [];
