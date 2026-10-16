// @ts-check
// Baseline & settings page controller (CD-4 §10): read-only weekday table, category settings, tags and About.

import { el, paint } from '../dom.js';
import { baselineViewModel } from '../../vm/baseline-vm.js';
import { EVENTS } from '../../core/events.js';

/**
 * @typedef {Object} BaselineDeps
 * @property {import('../../core/types.js').Category} category
 * @property {import('../../core/types.js').SettingsService} settingsService
 * @property {import('../../core/types.js').StoragePersist} storagePersist
 * @property {import('../../core/events.js').Emitter} bus
 * @property {string} appName
 * @property {string} appVersion
 */

// TODO(IT-06): editable cells, the tag dialog, restore defaults and writes through settingsService (CD-4 §10.2);
// renderList instead of rebuilding the lists.

/**
 * Rebuilds the weekday table head and body from the view-model.
 * @param {HTMLElement} root
 * @param {import('../../vm/baseline-vm.js').BaselineVM} vm
 */
function renderWeekdays(root, vm) {
  const head = root.querySelector('.weekday-table thead');
  const body = root.querySelector('.weekday-table tbody');
  if (!head || !body) return;
  head.replaceChildren(el('tr', {},
    el('th', { attrs: { scope: 'col' }, text: 'Day' }),
    ...vm.columns.map((c) => el('th', { attrs: { scope: 'col' }, text: c.label }))));
  body.replaceChildren(...vm.weekdays.map((row) => el('tr', {},
    el('th', { attrs: { scope: 'row', 'aria-label': row.name }, text: row.code }),
    ...Object.values(row.cells).map((cell) => el('td', { text: cell.summary })))));
}

/**
 * @param {HTMLElement} root
 * @param {import('../../vm/baseline-vm.js').BaselineVM} vm
 */
function renderSettings(root, vm) {
  const list = root.querySelector('.settings-list');
  if (!list) return;
  list.replaceChildren(...Object.values(vm.settings).map((s) => el('div', { class: 'about-row' },
    el('dt', { text: s.label }),
    el('dd', { text: s.summary }))));
}

/**
 * @param {HTMLElement} root
 * @param {import('../../vm/baseline-vm.js').BaselineVM} vm
 */
function renderTags(root, vm) {
  const list = root.querySelector('.tag-list');
  if (!list) return;
  list.replaceChildren(...vm.tags.map((t) => el('li', { class: `tag-row kind-${t.kindLabel.toLowerCase()}` },
    el('span', { class: 'tag-code', text: t.code }),
    el('span', { class: 'tag-glyph', attrs: { 'aria-hidden': 'true' }, text: t.glyph }),
    el('span', { class: 'tag-label', text: t.label }),
    el('span', { class: 'tag-kind', text: `${t.kindLabel}${t.retired ? ' (retired)' : ''}` }))));
}

/** @param {BaselineDeps} deps */
export function createBaselinePage(deps) {
  /** @type {HTMLElement|null} */
  let root = null;
  let visible = false;
  /** @type {import('../../core/types.js').BootReport|null} */
  let bootReport = null;
  /** persisted() result; undefined while pending. @type {boolean|null|undefined} */
  let storage;

  function render() {
    if (!root) return;
    const { settingsService: s, category } = deps;
    const vm = baselineViewModel({
      weekdays: s.getWeekdays(), settings: s.getSettings(), tags: s.getTags(), category,
      appName: deps.appName, appVersion: deps.appVersion, bootReport, storage,
    });
    renderWeekdays(root, vm);
    renderSettings(root, vm);
    renderTags(root, vm);
    paint(root, vm);
  }

  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
      deps.bus.on(EVENTS.BOOT_REPORT, (report) => {
        bootReport = report;
        if (visible) render();
      });
    },
    show() {
      visible = true;
      render();
      // The only async work in show(): paints when it resolves (CD-4 §5.5, NFR-REL-02).
      void deps.storagePersist.persisted().then((result) => {
        storage = result;
        if (visible) render();
      });
    },
    async hide() {
      visible = false;
    },
  };
}
