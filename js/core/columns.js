// @ts-check
// Framework CSV, History and entry-metric building blocks that categories compose (CC-21 rev 1, CD-6 §5.1).

import { weekdayOf } from './dates.js';

/** @typedef {import('./types.js').CsvColumn} CsvColumn */
/** @typedef {import('./types.js').ColumnDescriptor} ColumnDescriptor */
/** @typedef {import('./types.js').MetricDescriptor} MetricDescriptor */
/** @typedef {import('./types.js').ColumnContext} ColumnContext */

/**
 * One framework column: CSV header and token, History token, and the shared raw-value getter. `get` reads
 * ctx.derived, never record.derived (CC-16). `hidden`: the History block is `defaultHidden`; only Day, Date
 * (pinned) and Average are default-visible (FR-HIS-09, CC-21 rev 1.4).
 * @type {Array<{ key: string, header: string, csv: string, history: string, pinned?: boolean, hidden?: boolean,
 *                get: (ctx: ColumnContext) => number|string|null }>}
 */
const SPECS = [
  { key: 'day', header: 'Day', csv: 'weekday', history: 'weekday', pinned: true, get: (ctx) => weekdayOf(ctx.record.date) },
  { key: 'date', header: 'Date', csv: 'date', history: 'date', pinned: true, get: (ctx) => ctx.record.date },
  { key: 'morning', header: 'Morning', csv: 'int', history: 'int', hidden: true, get: (ctx) => ctx.record.scores?.morning ?? null },
  { key: 'afternoon', header: 'Afternoon', csv: 'int', history: 'int', hidden: true, get: (ctx) => ctx.record.scores?.afternoon ?? null },
  { key: 'evening', header: 'Evening', csv: 'int', history: 'int', hidden: true, get: (ctx) => ctx.record.scores?.evening ?? null },
  { key: 'other', header: 'Other', csv: 'text', history: 'text', hidden: true, get: (ctx) => (ctx.record.other ?? []).join(' ') },
  { key: 'average', header: 'Average', csv: 'dec1', history: 'dec1', get: (ctx) => ctx.derived.average },
  { key: 'low', header: 'Low', csv: 'int', history: 'int', hidden: true, get: (ctx) => ctx.derived.low },
  { key: 'high', header: 'High', csv: 'int', history: 'int', hidden: true, get: (ctx) => ctx.derived.high },
  { key: 'comment', header: 'Comment', csv: 'text', history: 'text', hidden: true, get: (ctx) => ctx.record.comment ?? '' },
  { key: 'baseline', header: 'Baseline', csv: 'dec1', history: 'dec1', hidden: true, get: (ctx) => ctx.record.baseline ?? null },
];

/** @type {Readonly<Object<string, Readonly<CsvColumn>>>} */
export const FRAMEWORK_CSV = Object.freeze(Object.fromEntries(SPECS.map((s) =>
  [s.key, Object.freeze({ header: s.header, get: s.get, format: s.csv })])));

/** Same ids as FRAMEWORK_CSV, label = header, display tokens (CD-6 §5.1). @type {Readonly<Object<string, Readonly<ColumnDescriptor>>>} */
export const FRAMEWORK_HISTORY = Object.freeze(Object.fromEntries(SPECS.map((s) =>
  [s.key, Object.freeze({ id: s.key, label: s.header, get: s.get, format: s.history, ...(s.pinned ? { pinned: true } : {}),
    ...(s.hidden ? { defaultHidden: true } : {}) })])));

/** @type {Readonly<{ average: Readonly<MetricDescriptor> }>} */
export const FRAMEWORK_METRICS = Object.freeze({
  average: Object.freeze({
    id: 'average', label: 'Average pain', get: (ctx) => ctx.derived.average, format: 'dec1', prominent: true,
    group: /** @type {'results'} */ ('results'),
  }),
});
