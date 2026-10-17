// @ts-check
// Records → CSV through the category's column lists: CSV format tokens, formula guard and recordsToCsv (CD-6 §5.2–§5.4).
// The extended layout is used from M2; the header helpers for import are M2.

import { isNum, toFixedString } from './numbers.js';
import { formatShortDate } from './dates.js';
import { buildContexts } from './engine.js';
import { writeCsv } from './csv.js';

/** @typedef {import('./types.js').DayRecord} DayRecord */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').IsoDate} IsoDate */
/** @typedef {import('./types.js').CsvExportOptions} CsvExportOptions */

/** Optional apostrophes, then a character a spreadsheet would treat as a formula start (CC-35 rev 1). */
const TRIGGER = /^'*[=+\-@\t\r]/;
const GUARDED = /^'+[=+\-@\t\r]/;

/**
 * Formula guard for every `text` cell on export (NFR-SEC-04): prefix one apostrophe. Values that already start
 * with apostrophes before a trigger are guarded too, so the round trip is exact ('=x → ''=x → '=x).
 * @param {string} s
 * @returns {string}
 */
export function guardFormula(s) {
  return TRIGGER.test(s) ? "'" + s : s;
}

/**
 * Inverse of guardFormula, applied to every import cell before interpretation (M2 import; CC-35 rev 1).
 * @param {string} s
 * @returns {string}
 */
export function unguardFormula(s) {
  return GUARDED.test(s) ? s.slice(1) : s;
}

/**
 * One cell's text for a CSV format token (CC-09).
 * @param {number|string|null|undefined} value   from CsvColumn.get
 * @param {string} token                         CC-09 CSV token
 * @returns {string}                             '' for blank
 */
export function formatCsvValue(value, token) {
  if (value === null || value === undefined || value === '') return '';
  switch (token) {
    case 'int': return isNum(value) ? /** @type {string} */ (toFixedString(value, 0)) : '';
    case 'dec1': return isNum(value) ? /** @type {string} */ (toFixedString(value, 1)) : '';   // '-90.9', '7.0', never '-0.0'
    case 'num': return isNum(value) ? String(value) : '';                                         // '0.4'
    case 'text': return guardFormula(String(value));
    case 'weekday': return String(value);
    case 'date': return formatShortDate(/** @type {IsoDate} */ (value));                         // '1-Aug-26'
    default: throw new Error(`Unknown CSV format token: ${token}`);                              // programming error
  }
}

/**
 * The CSV text of the records in the category's layout (CC-42). History metrics are computed over all records
 * before rows are filtered, so a row's rolling average never depends on includeIncomplete (CC-19 rev 1).
 * @param {readonly DayRecord[]} records   ALL records, ascending (CC-06)
 * @param {Category} category
 * @param {CsvExportOptions} opts
 * @returns {{ text: string, rowCount: number }}
 */
export function recordsToCsv(records, category, opts) {
  const cols = opts.layout === 'extended' ? category.csv.extended : category.csv.standard;
  const ctxs = buildContexts(/** @type {DayRecord[]} */ (records), category);
  /** @type {string[][]} */
  const rows = [cols.map((c) => c.header)];
  for (const ctx of ctxs) {
    if (!ctx.derived.complete && !opts.includeIncomplete) continue;
    rows.push(cols.map((c) => formatCsvValue(c.get(ctx), c.format)));
  }
  return { text: writeCsv(rows), rowCount: rows.length - 1 };
}
