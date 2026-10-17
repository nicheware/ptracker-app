// @ts-check
// History page controller (CD-4 §9): the record table newest first with pinned Day / Date, gap rows, day badges,
// "Show all columns", the summary, the Download CSV panel and Remove all data.

import { el, paint, renderList } from '../dom.js';
import { typeToConfirmDialog } from '../widgets.js';
import { messageFor, NOTICES } from '../messages.js';
import { historyViewModel, historySummary, exportPanelVm } from '../../vm/history-vm.js';
import { EVENTS } from '../../core/events.js';
import { todayIso } from '../../core/dates.js';

/** @typedef {import('../../vm/history-vm.js').HistoryVM} HistoryVM */
/** @typedef {import('../../vm/history-vm.js').HistoryColumnVM} HistoryColumnVM */
/** @typedef {import('../../vm/history-vm.js').HistoryRowVM} HistoryRowVM */
/** @typedef {import('../../vm/history-vm.js').HistoryGapVM} HistoryGapVM */

/**
 * @typedef {Object} HistoryDeps
 * @property {import('../../core/types.js').Category} category
 * @property {import('../../core/types.js').Clock} clock
 * @property {import('../../core/events.js').Emitter} bus
 * @property {import('../../core/types.js').Prefs} prefs
 * @property {{ getSettings(): import('../../core/types.js').Settings }} settingsService
 * @property {{ all(): readonly import('../../core/types.js').DayRecord[], flush(): Promise<void>,
 *              removeAll(): Promise<{ removed: number }> }} recordService
 * @property {import('../../core/types.js').TransferService} transferService
 * @property {(route: {page: string, date?: string|null}, opts?: {replace?: boolean}) => void} navigate
 */

const SHOW_ALL_KEY = 'history.showAllColumns';
const INCLUDE_KEY = 'export.includeIncomplete';
const LAYOUT_KEY = 'export.layout';
/** Rows built synchronously on the first render (one screenful plus margin), then chunks per frame (D4-07). */
const FIRST_ROWS = 60;
const CHUNK_ROWS = 300;

/** @param {FrameRequestCallback} fn */
const nextFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(fn) : setTimeout(() => fn(0), 16));

/** @param {HistoryDeps} deps */
export function createHistoryPage(deps) {
  const { category, clock, bus, prefs, recordService, settingsService, transferService, navigate } = deps;
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {HTMLElement|null} */
  let thead = null;
  /** @type {HTMLElement|null} */
  let tbody = null;
  /** @type {HTMLInputElement|null} */
  let toggle = null;
  /** @type {HTMLInputElement|null} */
  let includeToggle = null;
  /** @type {HTMLDialogElement|null} */
  let typeDlg = null;
  let visible = false;
  let stale = true;
  let showAll = false;
  let renderToken = 0;
  let removing = false;
  let exporting = false;
  /** @type {HistoryVM|null} */
  let lastVm = null;

  const today = () => todayIso(clock.now());

  /**
   * Export options from the prefs (CD-4 §9.5, CC-36). The layout is 'standard' while the category has no extended
   * layout (CC-20 rev 1; the choice is M2, FR-EXP-08).
   * @returns {import('../../core/types.js').CsvExportOptions}
   */
  const exportOpts = () => ({
    layout: category.csv.extended.length > 0 && prefs.get(LAYOUT_KEY, 'standard') === 'extended' ? 'extended' : 'standard',
    includeIncomplete: prefs.get(INCLUDE_KEY, false) === true,
  });

  /** Rows the CSV would have: built synchronously from the caches, for the label only (CC-42). */
  const exportCount = (/** @type {import('../../core/types.js').CsvExportOptions} */ opts) => transferService.csvFile(opts).rowCount;

  /** Column classes: pinned columns stick in order (pin-0 = Day, pin-1 = Date), numbers align right. */
  function columnClasses(/** @type {HistoryColumnVM[]} */ columns) {
    let pin = 0;
    return columns.map((c) => [`col-${c.id}`, c.pinned ? `pin pin-${pin++}` : '', c.align === 'num' ? 'num' : '']
      .filter(Boolean).join(' '));
  }

  /** The cell holding the row's link and badges: Date, else the first column. */
  const linkColumn = (/** @type {HistoryColumnVM[]} */ columns) => Math.max(0, columns.findIndex((c) => c.id === 'date'));

  /** @param {HistoryColumnVM} col */
  const hiddenAttr = (col) => (col.defaultHidden ? { 'data-default-hidden': true } : {});

  /** @param {HistoryColumnVM[]} columns */
  function buildHead(columns) {
    if (!thead) return;
    const classes = columnClasses(columns);
    thead.replaceChildren(el('tr', {}, ...columns.map((c, i) => (c.heading === c.label
      ? el('th', { class: classes[i], text: c.label, attrs: { scope: 'col', ...hiddenAttr(c) } })
      : el('th', { class: classes[i], attrs: { scope: 'col', title: c.label, ...hiddenAttr(c) } },   // short heading, full name read
        el('span', { attrs: { 'aria-hidden': 'true' }, text: c.heading }), el('span', { class: 'sr-only', text: c.label }))))));
  }

  /**
   * @param {HistoryRowVM|HistoryGapVM} item
   * @param {HistoryColumnVM[]} columns
   * @param {string[]} classes
   * @returns {HTMLElement}
   */
  function renderRow(item, columns, classes) {
    const date = item.href.slice('#entry/'.length);
    if (item.kind === 'gap') {
      return el('tr', { class: 'gap-row', dataset: { date } },
        el('td', { attrs: { colspan: String(columns.length) } },
          el('a', { class: 'gap-link', attrs: { href: item.href }, text: item.text })));
    }
    const link = linkColumn(columns);
    const rowClass = [item.incomplete ? 'is-incomplete' : '', item.off ? 'is-off' : ''].filter(Boolean).join(' ');
    return el('tr', { class: rowClass, dataset: { date } }, ...item.cells.map((cell, i) => {
      const col = columns[i];
      const cls = [classes[i], cell.tone ? `tone-${cell.tone}` : ''].filter(Boolean).join(' ');
      const value = i === link ? el('a', { class: 'row-link', attrs: { href: item.href }, text: cell.text })
        : el('span', { class: 'cell-text', text: cell.text });
      return el('td', { class: cls, attrs: hiddenAttr(col) },
        cell.tone === 'warning' ? el('span', { class: 'cell-warn' },
          el('span', { attrs: { 'aria-hidden': 'true' }, text: '⚠ ' }), el('span', { class: 'sr-only', text: 'Warning: ' })) : null,
        value,
        cell.note ? el('span', { class: 'cell-note', text: cell.note }) : null,
        i === link && item.badges.length > 0
          ? el('span', { class: 'row-badges' }, ...item.badges.map((b) =>
            el('span', { class: `badge badge-${b.id}${b.warning ? ' tone-warning' : ''}`, text: b.text })))
          : null);
    }));
  }

  /** Rows by key with signature reuse; the first fill is chunked so the first screenful appears at once (D4-07). */
  function renderRows(/** @type {HistoryVM} */ vm) {
    if (!tbody) return;
    const body = tbody;
    const token = ++renderToken;
    const classes = columnClasses(vm.columns);
    /** @param {Array<HistoryRowVM|HistoryGapVM>} items */
    const fill = (items) => renderList(body, items, (r) => r.key, (r) => renderRow(r, vm.columns, classes),
      { sigOf: (r) => (r.kind === 'gap' ? r.text : r.sig) });
    if (body.children.length > 0 || vm.rows.length <= FIRST_ROWS) {
      fill(vm.rows);
      return;
    }
    let shown = FIRST_ROWS;
    fill(vm.rows.slice(0, shown));
    const step = () => {
      if (token !== renderToken) return;                              // a newer render took over
      shown = Math.min(shown + CHUNK_ROWS, vm.rows.length);
      fill(vm.rows.slice(0, shown));
      if (shown < vm.rows.length) nextFrame(step);
    };
    nextFrame(step);
  }

  /** Rebuilds the view-model from the record cache and repaints everything. */
  function render() {
    if (!root) return;
    const opts = exportOpts();
    const vm = historyViewModel({ records: recordService.all(), category, settings: settingsService.getSettings(),
      today: today(), showAll, includeIncomplete: opts.includeIncomplete, exportCount: exportCount(opts) });
    if (thead && thead.children.length === 0) buildHead(vm.columns);
    renderRows(vm);
    lastVm = vm;
    stale = false;
    paint(root, vm);
  }

  /** Summary, toggles and export panel only; the rows are current (CD-4 §9.2 steps 2–3). */
  function repaint() {
    if (!root || !lastVm) return;
    const records = recordService.all();
    const opts = exportOpts();
    lastVm = { ...lastVm,
      summary: historySummary({ records, settings: settingsService.getSettings(), today: today() }),
      showAll: { ...lastVm.showAll, on: showAll },
      exportPanel: exportPanelVm({ records, includeIncomplete: opts.includeIncomplete, exportCount: exportCount(opts) }) };
    paint(root, lastVm);
  }

  /** @param {import('../toast.js').Toast} toast */
  const showToast = (toast) => bus.emit(EVENTS.UI_TOAST, toast);

  /**
   * Download CSV (CD-4 §9.5, FR-EXP-04): exportCsv is the first asynchronous step of the tap, with no await before it,
   * so iOS still sees the user's tap when the share sheet opens (CC-27 rev 1). A cancel shows nothing.
   * @returns {Promise<void>}
   */
  function runExport() {
    if (exporting) return Promise.resolve();
    exporting = true;
    /** @type {Promise<import('../../core/types.js').ExportResult>} */
    let pending;
    try {
      pending = transferService.exportCsv(exportOpts());
    } catch (e) {
      pending = Promise.reject(e);
    }
    return pending.then(({ outcome, trackingError }) => {
      if (outcome === 'cancelled') return;
      if (trackingError) showToast({ kind: 'warning', text: NOTICES.CSV_SAVED_UNTRACKED, action: null, sticky: false, key: 'export' });
      else showToast({ kind: 'success', text: NOTICES.CSV_SAVED, action: null, sticky: false, key: 'export' });
    }, (e) => {
      showToast({ kind: 'error', text: messageFor(e, 'export'), action: null, sticky: false, key: 'export' });
    }).finally(() => { exporting = false; });
  }

  /** Remove all data (CD-4 §9.6, FR-HIS-06): flush, typed confirmation (or Download CSV first), removeAll, toast. */
  async function removeAll() {
    if (!typeDlg || removing) return;
    removing = true;
    try {
      try {
        await recordService.flush();                                  // the save-error toast reports a failed save
      } catch { /* removeAll discards queued saves anyway (CC-30 rev 1) */ }
      render();
      const text = /** @type {HistoryVM} */ (lastVm).removeAll;
      if (text.disabled) return;
      let choice = await typeToConfirmDialog(typeDlg, { title: text.title, body: text.body, word: text.word,
        confirmLabel: text.confirmLabel, extraAction: text.extraAction });
      while (choice === 'extra') {
        await runExport();                                            // called before any other await: still the tap
        choice = await typeToConfirmDialog(typeDlg, { title: text.title, body: text.body, word: text.word,
          confirmLabel: text.confirmLabel, extraAction: null });
      }
      if (choice !== 'confirm') return;
      await recordService.removeAll();
      showToast({ kind: 'success', text: NOTICES.ALL_REMOVED, action: null, sticky: false, key: 'removeAll' });
    } catch (e) {
      showToast({ kind: 'error', text: messageFor(e, 'removeAll'), action: null, sticky: false, key: 'removeAll' });
    } finally {
      removing = false;
    }
  }

  /** @param {Event} event */
  function onClick(event) {
    const target = /** @type {Element} */ (event.target);
    const action = /** @type {HTMLElement|null} */ (target.closest('[data-action]'));
    if (action?.dataset.action === 'history.export') {
      void runExport();                                               // synchronous call inside the tap (CC-27 rev 1)
      return;
    }
    if (action?.dataset.action === 'history.removeAll') {
      void removeAll();
      return;
    }
    if (target.closest('a[href]')) return;                            // the link navigates by itself
    const row = /** @type {HTMLElement|null} */ (target.closest('tbody tr[data-date]'));
    if (row?.dataset.date) navigate({ page: 'entry', date: row.dataset.date });
  }

  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
      const doc = section.ownerDocument;
      thead = section.querySelector('table.history thead');
      tbody = section.querySelector('table.history tbody');
      toggle = section.querySelector(`input[data-pref="${SHOW_ALL_KEY}"]`);
      includeToggle = section.querySelector(`input[data-pref="${INCLUDE_KEY}"]`);
      typeDlg = /** @type {HTMLDialogElement|null} */ (doc.getElementById('dlg-type-confirm'));
      section.addEventListener('click', onClick);
      toggle?.addEventListener('change', () => {
        showAll = !!toggle?.checked;
        prefs.set(SHOW_ALL_KEY, showAll);
        repaint();                                                    // flips the table's show-all class only
      });
      includeToggle?.addEventListener('change', () => {
        prefs.set(INCLUDE_KEY, !!includeToggle?.checked);
        repaint();                                                    // new export count; the rows are unchanged
      });
      bus.on(EVENTS.EXPORT_DONE, () => {                              // "Last CSV download" (FR-HIS-07, CD-4 §9.2)
        stale = true;
        if (visible) render();
      });
      bus.on(EVENTS.DATA_CHANGED, (/** @type {{ scope: string }} */ { scope }) => {
        if (scope === 'records' || scope === 'all') stale = true;
        if (!visible) return;
        if (stale) render();
        else repaint();
      });
    },
    show() {
      visible = true;
      showAll = prefs.get(SHOW_ALL_KEY, false) === true;
      if (toggle) toggle.checked = showAll;
      if (includeToggle) includeToggle.checked = prefs.get(INCLUDE_KEY, false) === true;
      if (stale || !lastVm) render();
      else repaint();
    },
    async hide() {
      visible = false;
    },
  };
}
