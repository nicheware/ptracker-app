// @ts-check
// Entry page controller (CD-4 §8): input → applyInput → save → entryContext → view-model → paint; Delete this day.

import { el, paint, renderList, renderField, fillField, preciseFocus, preciseBlur, slug } from '../dom.js';
import { scorePicker, tagChip, confirmDialog } from '../widgets.js';
import { messageFor } from '../messages.js';
import { entryViewModel, resumeAction, rolloverNotice, metricDescriptors, metricGroup } from '../../vm/entry-vm.js';
import { addDays, isIsoDate, todayIso, weekdayOf } from '../../core/dates.js';
import { toInputText } from '../../core/format.js';
import { EVENTS } from '../../core/events.js';
import { toggleTag, setFreeText, defaultValueFor } from '../../core/record-model.js';

/** @typedef {import('../../core/types.js').IsoDate} IsoDate */
/** @typedef {import('../../core/types.js').FieldId} FieldId */
/** @typedef {import('../../core/types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('../../core/types.js').Draft} Draft */
/** @typedef {import('../../core/types.js').Tag} Tag */
/** @typedef {import('../../core/types.js').InputKind} InputKind */
/** @typedef {import('../../vm/entry-vm.js').EntryVM} EntryVM */

/** The framework's baseline field (CD-4 §8.1): precise decimal, 0–10 (FR-BAS-04/05). @type {FieldDescriptor} */
const BASELINE_DESC = Object.freeze({ type: 'decimal', key: 'baseline', label: 'Baseline', min: 0, max: 10 });
/** @type {FieldDescriptor} */
const OTHER_DESC = Object.freeze({ type: 'text', key: 'other', label: 'Other (free text)', inputMode: 'text',
  help: 'Words separated by spaces. A tag code becomes a tag.' });
/** @type {FieldDescriptor} */
const COMMENT_DESC = Object.freeze({ type: 'text', key: 'comment', label: 'Comment' });
const SCORES = Object.freeze([['scores.morning', 'Morning'], ['scores.afternoon', 'Afternoon'], ['scores.evening', 'Evening']]);

/**
 * @param {{ clock: import('../../core/types.js').Clock, bus: import('../../core/events.js').Emitter,
 *           category: import('../../core/types.js').Category,
 *           settingsService: import('../../core/types.js').SettingsService,
 *           recordService: ReturnType<typeof import('../../services/record-service.js').createRecordService>,
 *           navigate: (route: {page: string, date?: IsoDate|null}, opts?: {replace?: boolean}) => void }} deps
 */
export function createEntryPage(deps) {
  const { clock, bus, navigate, category, settingsService, recordService } = deps;
  const id = category.id;
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {HTMLInputElement|null} */
  let picker = null;
  let following = true;
  /** @type {Draft|null} */
  let draft = null;
  /** Read on show only (CD-4 §8.2). @type {{ tags: Tag[], today: IsoDate }} */
  let page = { tags: [], today: todayIso(clock.now()) };
  /** Combo fields whose More… was tapped (by slug). @type {Object<string, boolean>} */
  let expanded = {};
  /** @type {EntryVM|null} */
  let lastVm = null;
  /** "Saved" shows only after a save of the shown date since the last date change (CD-4 §8.3). */
  let showSaved = false;
  /** @type {HTMLDialogElement|null} */
  let confirmDlg = null;
  const toast = (/** @type {import('../toast.js').Toast} */ t) => bus.emit(EVENTS.UI_TOAST, t);

  /** @type {Map<FieldId, FieldDescriptor>} descriptors of the typed fields, for fillField */
  const descs = new Map([['baseline', BASELINE_DESC], ['other', OTHER_DESC], ['comment', COMMENT_DESC]]);
  for (const f of category.entryFields) descs.set(`category.${id}.${f.key}`, f);

  /** Steps to a date, replacing the history entry so stepping does not fill the stack (D4-04). */
  const goTo = (/** @type {IsoDate|null} */ date) => navigate({ page: 'entry', date }, { replace: true });
  const tagCodes = () => new Set(page.tags.map((t) => t.code));      // retired included (CC-13 rev 1)

  /**
   * The one input path (CD-4 §8.2): pure applyInput, save only when the record changed (invalid or unchanged
   * input keeps the same record, CC-17 rev 1), then repaint.
   * @param {FieldId} fieldId
   * @param {unknown} value
   * @param {InputKind} kind
   */
  function onInput(fieldId, value, kind) {
    if (!draft) return;
    const next = recordService.applyInput(draft, fieldId, value);
    if (next.record !== draft.record) {
      showSaved = true;
      recordService.save(next, { kind });
    }
    draft = next;
    refresh();
  }

  /** Delete this day (CD-4 §8.7, FR-SAVE-05): flush, confirm, delete, re-open the date with weekday defaults. */
  async function deleteDay() {
    if (!draft || !confirmDlg) return;
    const iso = draft.record.date;
    await recordService.flush();                    // never rejects
    const words = /** @type {EntryVM} */ (lastVm).deleteDialog;
    const ok = await confirmDialog(confirmDlg, { title: words.title, body: words.body, confirmLabel: words.confirmLabel, danger: true });
    if (!ok) return;
    try {
      await recordService.delete(iso);
      toast({ kind: 'success', text: words.done, action: null, sticky: false, key: 'delete' });
      if (draft?.record.date === iso) show({ date: following ? null : iso });
    } catch (e) {
      toast({ kind: 'error', text: messageFor(e, 'delete'), action: null, sticky: false, key: 'delete' });
    }
  }

  /** @type {Object<string, (target: HTMLElement) => void>} */
  const actions = {
    'date.prev': () => goTo(addDays(currentIso(), -1)),
    'date.next': () => {
      if (currentIso() < todayIso(clock.now())) goTo(addDays(currentIso(), 1));
    },
    'date.today': () => goTo(null),
    'score.clear': (target) => {
      const fieldId = /** @type {FieldId} */ (target.dataset.target);
      onInput(fieldId, null, 'tap');
      if (root) fillField(root, fieldId, null, BASELINE_DESC);
    },
    'tag.toggle': (target) => {
      if (draft) onInput('other', toggleTag(draft.record.other, target.dataset.code ?? ''), 'tap');
    },
    'combo.pick': (target) => {
      const fieldId = /** @type {FieldId} */ (target.dataset.target);
      onInput(fieldId, target.dataset.value ?? '', 'tap');
      if (root) fillField(root, fieldId, '', /** @type {FieldDescriptor} */ (descs.get(fieldId)));
    },
    'combo.more': (target) => {
      expanded = { ...expanded, [slug(target.dataset.target ?? '')]: true };
      refresh();
    },
    'field.reset': (target) => {
      const fieldId = /** @type {FieldId} */ (target.dataset.target);
      const row = settingsService.getWeekday(weekdayOf(currentIso()));
      const value = defaultValueFor(fieldId, row, category);
      onInput(fieldId, toInputText(value), 'tap');
      if (root) fillField(root, fieldId, value, /** @type {FieldDescriptor} */ (descs.get(fieldId)));
    },
    'record.delete': () => { void deleteDay(); },
  };

  const currentIso = () => /** @type {Draft} */ (draft)?.record.date ?? todayIso(clock.now());

  function refresh() {
    if (!root || !draft) return;
    const ctx = recordService.entryContext(draft);
    const vm = /** @type {EntryVM} */ (entryViewModel({ draft, ctx, category, ...page, ui: { expanded, showSaved } }));
    lastVm = vm;
    renderDynamic(root, vm);
    paint(root, vm);
  }

  /** Lists rebuilt on every refresh (keyed, reused by signature): badges, tag chips, combo chips (CD-4 §8.1). */
  function renderDynamic(/** @type {HTMLElement} */ section, /** @type {EntryVM} */ vm) {
    const badges = /** @type {HTMLElement} */ (section.querySelector('.day-badges'));
    renderList(badges, vm.badges, (b) => b.id, (b) => el('span', { class: `badge${b.warning ? ' tone-warning' : ''}` },
      b.warning ? el('span', { attrs: { 'aria-hidden': 'true' }, text: '⚠ ' }) : null, b.text),
    { sigOf: (b) => `${b.text}|${b.warning}` });

    const chips = /** @type {HTMLElement} */ (section.querySelector('.chips'));
    renderList(chips, vm.chipList, (c) => c.key, (c) => tagChip(c, `chips.${c.key}.ariaPressed`),
      { sigOf: (c) => `${c.label}|${c.kind}|${c.retired}` });

    for (const group of /** @type {HTMLElement[]} */ ([...section.querySelectorAll('[data-combo]')])) {
      const fieldId = /** @type {FieldId} */ (group.dataset.combo);
      const key = slug(fieldId);
      const combo = vm.combos[key];
      if (!combo) continue;
      renderList(group, combo.options.map((o, i) => ({ ...o, i })), (o) => o.key,
        (o) => el('button', {
          class: 'chip combo-chip', text: o.label,
          attrs: { type: 'button', role: 'radio', 'aria-checked': 'false' },
          dataset: { action: 'combo.pick', target: fieldId, value: o.value, attr: `combos.${key}.options.${o.i}.ariaChecked:aria-checked` },
        }), { sigOf: (o) => `${o.i}|${o.label}` });
    }
  }

  /**
   * Writes control values on load only (CD-4 §8.5); a focused control is never written.
   * @param {EntryVM} vm
   */
  function fillAll(vm) {
    if (!root || !draft) return;
    const active = root.ownerDocument.activeElement;
    const { record, invalid } = draft;
    /** @param {FieldId} fieldId @param {unknown} value */
    const fill = (fieldId, value) => {
      const desc = descs.get(fieldId) ?? BASELINE_DESC;
      const focused = active instanceof HTMLElement && active.dataset.field === fieldId
        && !(active instanceof HTMLInputElement && active.type === 'radio');
      if (!focused && root) fillField(root, fieldId, /** @type {any} */ (invalid[fieldId] ?? value), desc);
    };
    for (const [fieldId] of SCORES) fill(fieldId, record.scores[/** @type {'morning'} */ (fieldId.slice(7))]);
    fill('baseline', record.baseline);
    for (const f of category.entryFields) {
      const fieldId = `category.${id}.${f.key}`;
      fill(fieldId, f.type === 'combo' ? vm.combos[slug(fieldId)]?.newText ?? '' : record.category[id]?.[f.key] ?? null);
    }
    fill('other', vm.otherText);
    fill('comment', record.comment);
    if (picker && picker.value !== record.date) picker.value = record.date;
  }

  /** @param {{ date?: IsoDate|null }} params */
  function show({ date = null } = {}) {
    following = !date;
    const today = todayIso(clock.now());
    const iso = date ?? today;
    if (!draft || draft.record.date !== iso) {
      expanded = {};
      showSaved = false;
    }
    if (draft && draft.record.date !== iso) void recordService.flush();   // not awaited; never rejects (CD-4 §8.2)
    draft = recordService.openDraft(iso);
    page = { tags: [...settingsService.getTags()], today };
    refresh();
    if (lastVm) fillAll(lastVm);
  }

  /** Builds the descriptor-driven DOM once (CD-4 §14): score pickers, metric rows, category fields, Other, Comment. */
  function build(/** @type {HTMLElement} */ section) {
    const scores = /** @type {HTMLElement} */ (section.querySelector('.scores'));
    scores.replaceChildren(...SCORES.map(([fieldId, label]) => scorePicker(fieldId, label)));

    const metricRow = (/** @type {import('../../core/types.js').MetricDescriptor} */ d) => {
      const p = `metrics.${d.id}`;
      return el('div', { class: `metric metric-${d.id}${d.prominent ? ' is-prominent' : ''}`, dataset: { show: `${p}.show` } },
        el('dt', { class: 'metric-label', dataset: { out: `${p}.label` } }),
        el('dd', { class: 'metric-value-wrap', dataset: { attr: `${p}.tone:data-tone` } },
          el('span', { class: 'metric-value', dataset: { out: `${p}.value` } }),
          el('span', { class: 'metric-warn', text: '⚠', attrs: { 'aria-hidden': 'true' }, dataset: { show: `${p}.warning` }, hidden: true }),
          el('span', { class: 'metric-note', dataset: { out: `${p}.note` } })));
    };
    const descriptors = metricDescriptors(category);
    /** @type {HTMLElement} */ (section.querySelector('.metrics-results'))
      .replaceChildren(...descriptors.filter((d) => metricGroup(d) === 'results').map(metricRow));
    /** @type {HTMLElement} */ (section.querySelector('.metrics-context'))
      .replaceChildren(...descriptors.filter((d) => metricGroup(d) === 'context').map(metricRow));

    /** @type {HTMLElement} */ (section.querySelector('.cat-fields')).replaceChildren(
      ...category.entryFields.map((f) => renderField(f, `category.${id}.${f.key}`, { defaultLine: !!f.weekdayDefault })),
      renderField(BASELINE_DESC, 'baseline', { precise: true, defaultLine: true }));
    /** @type {HTMLElement} */ (section.querySelector('.other')).replaceChildren(renderField(OTHER_DESC, 'other'));
    /** @type {HTMLElement} */ (section.querySelector('.comment')).replaceChildren(
      renderField(COMMENT_DESC, 'comment', { multiline: true }));
    const other = section.querySelector('[data-field="other"]');
    other?.setAttribute('autocapitalize', 'off');
    other?.setAttribute('spellcheck', 'false');
  }

  /** @param {HTMLElement} section */
  function listen(section) {
    section.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement|null} */ (/** @type {Element} */ (event.target).closest('[data-action]'));
      const run = target && actions[target.dataset.action ?? ''];
      if (run && target) run(target);
    });
    section.addEventListener('change', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.dataset.actionInput === 'date.pick') {
        // A future date is impossible through max, and the router redirects it anyway (FR-DATE-03).
        if (isIsoDate(target.value)) goTo(target.value);
        return;
      }
      const fieldId = target.dataset.field;
      if (!fieldId) return;
      if (target.type === 'radio') {
        onInput(fieldId, Number(target.value), 'tap');
      } else if (target.dataset.precise !== undefined) {
        onInput(fieldId, target.value, 'tap');
        if (draft && draft.invalid[fieldId] === undefined && root) {
          fillField(root, fieldId, /** @type {any} */ (draft.record)[fieldId], BASELINE_DESC);
        }
      }
    });
    section.addEventListener('input', (event) => {
      const target = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (event.target);
      const fieldId = target.dataset.field;
      if (!fieldId || target.dataset.precise !== undefined || /** @type {HTMLInputElement} */ (target).type === 'radio') return;
      if (fieldId === 'other') {
        if (draft) onInput('other', setFreeText(draft.record.other, target.value, (t) => tagCodes().has(t)), 'text');
      } else {
        onInput(fieldId, target.value, 'text');
      }
    });
    section.addEventListener('focusin', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.dataset?.precise !== undefined) preciseFocus(target);
    });
    section.addEventListener('focusout', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.dataset?.precise !== undefined) preciseBlur(target);
    });
    section.addEventListener('keydown', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (event.key === 'Enter' && target.tagName === 'INPUT' && target.type === 'text') target.blur();   // dismiss the iOS keyboard
    });
  }

  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
      picker = section.querySelector('input[type="date"]');
      build(section);
      listen(section);
      picker?.addEventListener('click', () => {
        // Desktop browsers open the picker only from its icon; the input is transparent over the date text.
        try { picker?.showPicker?.(); } catch { /* not allowed or unsupported: the native control still works */ }
      });
      confirmDlg = /** @type {HTMLDialogElement|null} */ (section.ownerDocument.getElementById('dlg-confirm'));
      bus.on(EVENTS.SAVE_STATUS, (/** @type {{ date: IsoDate|null }} */ { date }) => {
        if (!draft || root?.hidden) return;
        if (date === draft.record.date) {
          showSaved = true;
          refresh();
        } else if (date === null) refresh();
      });
      bus.on(EVENTS.DATA_CHANGED, (/** @type {{ scope: string, dates: IsoDate[]|null }} */ { scope, dates }) => {
        // Other dates' records can change this date's history (active program); own saves are already painted.
        if (!draft || root?.hidden || scope !== 'records') return;
        if (dates === null || dates.some((d) => d !== draft?.record.date)) refresh();
      });
      bus.on(EVENTS.APP_RESUME, ({ dayChanged, today }) => {
        if (root?.hidden || !draft) return;           // a hidden Entry re-reads today on its next show()
        const ctx = recordService.entryContext(draft);
        const action = resumeAction({ following, dayChanged, shown: draft.record.date, today,
          hasRecord: ctx.persisted, complete: ctx.derived.complete });
        if (action === 'today') show({ date: null });
        else if (action === 'stay') {
          const shown = draft.record.date;
          navigate({ page: 'entry', date: shown }, { replace: true });   // re-pin #entry/<yesterday> (D4-09)
          const notice = rolloverNotice(today);
          toast({ kind: 'info', text: notice.text, action: { label: notice.action, run: () => goTo(null) }, sticky: false, key: 'rollover' });
        } else if (action === 'refresh') {
          page = { ...page, today: todayIso(clock.now()) };
          refresh();
        }
      });
    },
    show,
    async hide() {
      if (confirmDlg?.open) confirmDlg.close('cancel');
      await recordService.flush();                    // never rejects (CC-25 rev 1); resolves when committed
    },
  };
}
