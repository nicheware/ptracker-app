// @ts-check
// Entry page controller (CD-4 §8): date header and day navigation; scores and results arrive in IT-07.

import { paint } from '../dom.js';
import { entryViewModel, resumeAction } from '../../vm/entry-vm.js';
import { addDays, isIsoDate, todayIso } from '../../core/dates.js';
import { EVENTS } from '../../core/events.js';

/** @typedef {import('../../core/types.js').IsoDate} IsoDate */

/**
 * @param {{ clock: import('../../core/types.js').Clock, bus: import('../../core/events.js').Emitter,
 *           navigate: (route: {page: string, date?: IsoDate|null}, opts?: {replace?: boolean}) => void }} deps
 */
export function createEntryPage(deps) {
  const { clock, bus, navigate } = deps;
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {HTMLInputElement|null} */
  let picker = null;
  let following = true;
  /** @type {IsoDate} */
  let iso = todayIso(clock.now());
  // TODO(IT-07): the draft comes from recordService.openDraft(iso); this stand-in carries only the date.
  let draft = { record: { date: iso } };

  /** Steps to a date, replacing the history entry so stepping does not fill the stack (D4-04). */
  const goTo = (/** @type {IsoDate|null} */ date) => navigate({ page: 'entry', date }, { replace: true });

  /** @type {Object<string, () => void>} */
  const actions = {
    'date.prev': () => goTo(addDays(iso, -1)),
    'date.next': () => {
      if (iso < todayIso(clock.now())) goTo(addDays(iso, 1));
    },
    'date.today': () => goTo(null),
  };

  function refresh() {
    if (!root) return;
    // TODO(IT-07): ctx = recordService.entryContext(draft), with category, tags and suggestions.
    paint(root, entryViewModel({ draft, today: todayIso(clock.now()) }));
  }

  /** @param {{ date?: IsoDate|null }} params */
  function show({ date = null } = {}) {
    following = !date;
    iso = date ?? todayIso(clock.now());
    draft = { record: { date: iso } };
    fillAll();
    refresh();
  }

  /** Inputs are written on load only (CD-4 §8.5). */
  function fillAll() {
    if (picker && picker.value !== iso) picker.value = iso;
  }

  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
      picker = section.querySelector('input[type="date"]');
      section.addEventListener('click', (event) => {
        const target = /** @type {Element} */ (event.target).closest('[data-action]');
        const run = target && actions[/** @type {HTMLElement} */ (target).dataset.action ?? ''];
        if (run) run();
      });
      section.addEventListener('change', (event) => {
        const target = /** @type {HTMLInputElement} */ (event.target);
        if (target.dataset.actionInput !== 'date.pick') return;
        // A future date is impossible through max, and the router redirects it anyway (FR-DATE-03).
        if (isIsoDate(target.value)) goTo(target.value);
      });
      picker?.addEventListener('click', () => {
        // Desktop browsers open the picker only from its icon; the input is transparent over the date text.
        try { picker?.showPicker?.(); } catch { /* not allowed or unsupported: the native control still works */ }
      });
      bus.on(EVENTS.APP_RESUME, ({ dayChanged }) => {
        if (root?.hidden) return;                     // a hidden Entry re-reads today on its next show()
        const action = resumeAction({ following, dayChanged });
        if (action === 'today') show({ date: null });
        else if (action === 'refresh') refresh();
      });
    },
    show,
    async hide() {
      // TODO(IT-08): await recordService.flush().
    },
  };
}
