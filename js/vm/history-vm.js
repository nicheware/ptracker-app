// @ts-check
// History view-model: columns and their default visibility, rows newest first, gaps, day badges, the summary and
// the remove-all dialog text (CD-4 §9.3, §9.6).
// TODO(IT-10): the export panel (exportCount, includeIncomplete, button label) and the real "last export" values.

import { buildContexts } from '../core/engine.js';
import { BLANK, formatValue, formatTimestampDate } from '../core/format.js';
import { addDays, daysBetween, formatShortDate, todayIso } from '../core/dates.js';

/** @typedef {import('../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').IsoDate} IsoDate */
/** @typedef {import('../core/types.js').ColumnDescriptor} ColumnDescriptor */
/** @typedef {import('../core/types.js').ColumnContext} ColumnContext */

/**
 * @typedef {Object} HistoryColumnVM
 * @property {string} id
 * @property {string} label           full name (screen readers, tooltip)
 * @property {string} heading         shown heading: shortLabel ?? label (CC-21 rev 1.5)
 * @property {boolean} pinned
 * @property {boolean} defaultHidden   hidden while "Show all columns" is off (the cells carry data-default-hidden)
 * @property {boolean} hidden          !pinned && defaultHidden && !showAll (FR-HIS-09/10)
 * @property {'num'|'text'} align
 *
 * @typedef {{ text: string, tone: string, note: string }} HistoryCellVM
 *
 * @typedef {Object} HistoryRowVM
 * @property {'record'} kind
 * @property {IsoDate} key
 * @property {string} href             '#entry/<date>'
 * @property {HistoryCellVM[]} cells   aligned with columns, hidden ones included
 * @property {Array<{ id: string, text: string, warning: boolean }>} badges   'incomplete' first, then dayBadges
 * @property {boolean} incomplete
 * @property {boolean} off             any cell has tone 'off' (NV-PRG-05)
 * @property {string} sig              changes when anything shown in the row changes (renderList reuse)
 *
 * @typedef {Object} HistoryGapVM
 * @property {'gap'} kind
 * @property {string} key              'gap-<first missing date>'
 * @property {string} href             '#entry/<latest missing date>'
 * @property {string} text
 * @property {IsoDate} before          the record date the gap row follows in newest-first order
 *
 * @typedef {{ count: string, range: string, lastExport: string }} HistorySummaryVM
 *
 * @typedef {Object} HistoryVM
 * @property {boolean} empty
 * @property {boolean} hasRows         the table is shown
 * @property {HistorySummaryVM} summary
 * @property {HistoryColumnVM[]} columns
 * @property {Array<HistoryRowVM|HistoryGapVM>} rows
 * @property {{ shown: boolean, on: boolean, label: string }} showAll
 * @property {{ title: string, body: string, word: string, confirmLabel: string, disabled: boolean }} removeAll
 */

const NUMERIC = new Set(['int', 'dec1', 'pct1Signed', 'pct0Signed', 'ml']);
/** Up to this many missing days get one row each; more become one summary row (CD-4 §9.3, FR-HIS-08). */
const GAP_ROWS_MAX = 3;

export const INCOMPLETE_TEXT = 'Incomplete';
export const SHOW_ALL_LABEL = 'Show all columns';

/**
 * Column view-models in the category's order (CC-21 rev 1.4).
 * @param {Category} category
 * @param {boolean} showAll
 * @returns {HistoryColumnVM[]}
 */
export function historyColumnVms(category, showAll) {
  return category.historyColumns.map((c) => {
    const defaultHidden = !c.pinned && !!c.defaultHidden;
    return { id: c.id, label: c.label, heading: c.shortLabel ?? c.label, pinned: !!c.pinned, defaultHidden, hidden: defaultHidden && !showAll,
      align: NUMERIC.has(c.format) ? 'num' : 'text' };
  });
}

/**
 * @param {ColumnDescriptor} col
 * @param {ColumnContext} ctx
 * @returns {HistoryCellVM}
 */
function cellVm(col, ctx) {
  const raw = col.get(ctx);
  const blank = raw === null || raw === undefined || raw === '';
  return {
    text: blank ? (col.blankText ?? BLANK) : formatValue(raw, col.format),
    tone: col.tone?.(ctx) ?? '',
    note: col.note?.(ctx) ?? '',
  };
}

/**
 * Gap rows for the dates with no record between consecutive records (FR-HIS-08), newest first. 1–3 missing days
 * give one row per date; 4 or more give one summary row that opens the latest missing date.
 * @param {readonly DayRecord[]} records   ascending
 * @returns {HistoryGapVM[]}
 */
export function gapItems(records) {
  /** @type {HistoryGapVM[]} */
  const out = [];
  for (let i = records.length - 1; i > 0; i--) {
    const later = records[i].date;
    const earlier = records[i - 1].date;
    const missing = daysBetween(earlier, later) - 1;
    if (missing <= 0) continue;
    const from = addDays(earlier, 1);
    const to = addDays(later, -1);
    if (missing <= GAP_ROWS_MAX) {
      for (let d = to; d >= from; d = addDays(d, -1)) {
        out.push({ kind: 'gap', key: `gap-${d}`, href: `#entry/${d}`, text: `1 day with no record (${formatShortDate(d)})`,
          before: later });
      }
    } else {
      out.push({ kind: 'gap', key: `gap-${from}`, href: `#entry/${to}`,
        text: `${missing} days with no record (${formatShortDate(from)} – ${formatShortDate(to)})`, before: later });
    }
  }
  return out;
}

/**
 * "Last CSV download" text: never, or the local date with how long ago (FR-HIS-07, FR-EXP-07).
 * @param {string|null|undefined} ts
 * @param {IsoDate} today
 */
function lastExportText(ts, today) {
  const date = formatTimestampDate(ts ?? null);
  if (date === BLANK) return 'never';
  const ago = daysBetween(todayIso(new Date(Date.parse(/** @type {string} */ (ts)))), today);
  if (ago === 0) return `${date} (today)`;
  if (ago === 1) return `${date} (yesterday)`;
  return ago > 1 ? `${date} (${ago} days ago)` : date;
}

/**
 * Count, date range and last download (FR-HIS-07). Cheap: used alone when the rows are still current (CD-4 §9.2).
 * @param {{ records: readonly DayRecord[], settings: Settings|null, today: IsoDate }} input
 * @returns {HistorySummaryVM}
 */
export function historySummary({ records, settings, today }) {
  const n = records.length;
  const first = n > 0 ? formatShortDate(records[0].date) : '';
  const last = n > 0 ? formatShortDate(records[n - 1].date) : '';
  return {
    count: n === 1 ? '1 day' : `${n} days`,
    range: n === 0 ? '' : n === 1 ? first : `${first} – ${last}`,
    lastExport: `Last CSV download: ${lastExportText(settings?.lastExportAt, today)}`,
  };
}

/**
 * Remove-all dialog text (CD-4 §9.6, FR-HIS-06): recommends a CSV first; speaks of day records only.
 * @param {number} n
 */
function removeAllVm(n) {
  const what = n === 1 ? 'the 1 day record' : `all ${n} day records`;
  return {
    title: 'Remove all day records?',
    body: `This deletes ${what} from this device. Your baselines, settings and tags are kept. `
      + 'Download a CSV first so you have a copy.',
    word: 'DELETE',
    confirmLabel: 'Remove all',
    disabled: n === 0,
  };
}

/**
 * @param {{ records: readonly DayRecord[], category: Category, settings: Settings|null, today: IsoDate,
 *           showAll: boolean }} input   records ascending (recordService.all())
 * @returns {HistoryVM}
 */
export function historyViewModel({ records, category, settings, today, showAll }) {
  const columns = historyColumnVms(category, showAll);
  const ctxs = buildContexts(/** @type {DayRecord[]} */ (records), category);   // over all records (CC-19 rev 1)
  /** @type {Map<IsoDate, HistoryGapVM[]>} */
  const gapsAfter = new Map();
  for (const g of gapItems(records)) gapsAfter.set(g.before, [...(gapsAfter.get(g.before) ?? []), g]);

  /** @type {Array<HistoryRowVM|HistoryGapVM>} */
  const rows = [];
  for (let i = ctxs.length - 1; i >= 0; i--) {                                    // newest first (FR-HIS-01)
    const ctx = ctxs[i];
    const incomplete = !ctx.derived.complete;
    const cells = category.historyColumns.map((col) => cellVm(col, ctx));
    // FR-HIS-04: an "Incomplete" badge under the date, so the derived cells stay '—' and no column widens.
    const badges = [...(incomplete ? [{ id: 'incomplete', text: INCOMPLETE_TEXT, warning: false }] : []),
      ...(category.dayBadges?.(ctx) ?? []).map((b) => ({ id: b.id, text: b.text, warning: b.tone === 'warning' }))];
    const date = ctx.record.date;
    rows.push({
      kind: 'record', key: date, href: `#entry/${date}`, cells, badges, incomplete,
      off: cells.some((c) => c.tone === 'off'),
      sig: JSON.stringify([cells, badges, incomplete]),
    });
    rows.push(...(gapsAfter.get(date) ?? []));
  }

  return {
    empty: records.length === 0,
    hasRows: records.length > 0,
    summary: historySummary({ records, settings, today }),
    columns,
    rows,
    showAll: { shown: columns.some((c) => c.defaultHidden), on: showAll, label: SHOW_ALL_LABEL },
    removeAll: removeAllVm(records.length),
  };
}
