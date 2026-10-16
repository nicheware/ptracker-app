// @ts-check
// Entry view-model: pure display state for the Entry page (CD-4 §8.3): date header, results, fields, chips, combos.

import { addDays, formatLongDate, formatShortDate, weekdayName, weekdayOf } from '../core/dates.js';
import { formatValue, kindGlyph, kindLabel, toInputText, BLANK } from '../core/format.js';
import { FRAMEWORK_METRICS } from '../core/columns.js';
import { splitOther } from '../core/record-model.js';

/** @typedef {import('../core/types.js').IsoDate} IsoDate */
/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').EntryContext} EntryContext */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Tag} Tag */
/** @typedef {import('../core/types.js').FieldId} FieldId */
/** @typedef {import('../core/types.js').MetricDescriptor} MetricDescriptor */
/** @typedef {import('../core/types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('../core/types.js').ColumnContext} ColumnContext */

/** Known combo options shown before More… (CD-4 §6.4). */
export const COMBO_VISIBLE = 6;

/**
 * @typedef {Object} DateVM
 * @property {IsoDate} iso
 * @property {string} long           'Friday 17 July 2026' (FR-DATE-04)
 * @property {string} short          '17-Jul-26' (FR-DATE-04)
 * @property {string} weekday        full weekday name, 'Friday'
 * @property {boolean} isToday
 * @property {boolean} nextDisabled  no stepping past today (FR-DATE-03)
 * @property {boolean} showToday     the Today button, shown away from today
 * @property {IsoDate} max           the date picker's max (FR-DATE-03)
 *
 * @typedef {Object} MetricVM
 * @property {string} label
 * @property {string} value          formatted, or the descriptor's blankText, or '—'
 * @property {string} note           '' when none
 * @property {boolean} warning       tone 'warning': shown with the ⚠ glyph
 * @property {boolean} show          false when hideWhenBlank and blank
 * @property {string} tone           '' | Tone
 * @property {boolean} prominent
 *
 * @typedef {Object} FieldVM
 * @property {boolean} overridden    ctx.overridden[fieldId] (exact compare with the current row, CC-12)
 * @property {string} defaultText    'Default 0.4 ml' / 'Default none'
 * @property {string} summary        1 dp text for precise fields at rest
 * @property {boolean} offerReset    overridden && not invalid
 *
 * @typedef {Object} ChipVM
 * @property {string} key            chipKey(code), a path-safe key
 * @property {string} code
 * @property {string} label
 * @property {string} kind
 * @property {string} kindLabel
 * @property {string} glyph
 * @property {boolean} retired
 * @property {boolean} pressed
 * @property {'true'|'false'} ariaPressed
 *
 * @typedef {Object} ComboOptionVM
 * @property {string} key            path-safe key
 * @property {string} value          '' for None
 * @property {string} label
 * @property {boolean} checked
 * @property {'true'|'false'} ariaChecked
 *
 * @typedef {Object} ComboVM
 * @property {string|null} selected
 * @property {string} newText        text for the "New name" input ('' when a chip holds the value)
 * @property {ComboOptionVM[]} options
 * @property {boolean} more          More… is offered
 * @property {string} summary        'Changing tonight to: KM8', or the descriptor placeholder
 *
 * @typedef {Object} EntryVM
 * @property {DateVM} date
 * @property {{text: string, error: boolean}} status
 * @property {boolean} complete
 * @property {Object<string, MetricVM>} metrics        keyed by MetricDescriptor.id (both groups)
 * @property {Array<{id: string, text: string, warning: boolean}>} badges
 * @property {{low: string, high: string, baseline: string}} secondary
 * @property {Object<string, FieldVM>} fields          keyed by slug(FieldId)
 * @property {Object<FieldId, string>} errors          first issue message per field (CC-23)
 * @property {Object<string, ChipVM>} chips            keyed by chipKey(code)
 * @property {ChipVM[]} chipList                       chips in display order
 * @property {Object<string, ComboVM>} combos          keyed by slug(FieldId)
 * @property {string} otherText                        free-text tokens of the Other list
 * @property {{show: boolean, text: string, token: string}} suggestion
 * @property {boolean} canDelete
 * @property {{ title: string, body: string, confirmLabel: string, done: string }} deleteDialog   CD-4 §8.7
 * @property {string} announce                         live-region text (CD-4 §13)
 */

/** FieldId → path-safe key (CD-4 §6.2 slug rule). @param {string} fieldId */
const slug = (fieldId) => fieldId.replace(/\./g, '_');

/**
 * A path-safe key for any token (tag code or option value): letters, digits, '_' and '-' kept, every other
 * character written as _<code>_ so paths never contain '.' or ':' (CC-32 data-* paths).
 * @param {string} text
 * @returns {string}
 */
export function chipKey(text) {
  return `k${[...String(text)].map((ch) => (/[A-Za-z0-9-]/.test(ch) ? ch : `_${ch.codePointAt(0)}_`)).join('')}`;
}

/**
 * Date header state (CD-4 §8.3 `date`).
 * @param {IsoDate} iso
 * @param {IsoDate} today
 * @returns {DateVM}
 */
function dateViewModel(iso, today) {
  return {
    iso,
    long: formatLongDate(iso),
    short: formatShortDate(iso),
    weekday: weekdayName(weekdayOf(iso)),
    isToday: iso === today,
    nextDisabled: iso >= today,
    showToday: iso !== today,
    max: today,
  };
}

/**
 * The entry metrics in display order: category.displayMetrics, with FRAMEWORK_METRICS.average prepended when the
 * category lists no 'average' (CC-21 rev 1, FR-ENT-08). Used by the VM and by the page to build its rows.
 * @param {Category} category
 * @returns {MetricDescriptor[]}
 */
export function metricDescriptors(category) {
  const list = category.displayMetrics ?? [];
  return list.some((d) => d.id === 'average') ? [...list] : [FRAMEWORK_METRICS.average, ...list];
}

/** @param {MetricDescriptor} d */
export const metricGroup = (d) => d.group ?? 'results';

/**
 * @param {MetricDescriptor} d
 * @param {ColumnContext} cc
 * @returns {MetricVM}
 */
function metricVm(d, cc) {
  const raw = d.get(cc);
  const blank = raw === null || raw === undefined || raw === '';
  const tone = d.tone?.(cc) ?? '';
  return {
    label: d.label,
    value: blank ? (d.blankText ?? BLANK) : formatValue(raw, d.format),
    note: d.note?.(cc) ?? '',
    warning: tone === 'warning',
    show: !(blank && d.hideWhenBlank),
    tone,
    prominent: !!d.prominent,
  };
}

/** @param {import('../core/types.js').SaveStatus|undefined} save @param {boolean} showSaved */
function statusText(save, showSaved) {
  switch (save?.status) {
    case 'pending':
    case 'saving': return { text: 'Saving…', error: false };
    case 'saved': return { text: showSaved ? 'Saved' : '', error: false };
    case 'error': return { text: 'Not saved', error: true };
    default: return { text: '', error: false };
  }
}

/**
 * Default line text for a weekday-default field: 'Default 0.4 ml', 'Default 4.7', 'Default none'.
 * @param {number|string|null} value
 * @param {string|undefined} unit
 * @param {boolean} precise
 */
function defaultText(value, unit, precise) {
  if (value === null || value === undefined) return 'Default none';
  const text = precise && typeof value === 'number' ? formatValue(value, 'dec1') : toInputText(value);
  return `Default ${text}${unit ? ` ${unit}` : ''}`;
}

/**
 * Chips: every non-retired tag in catalogue order, then retired tags that this record uses (CD-4 §8.6).
 * @param {Tag[]} tags   ordered by `order`
 * @param {string[]} other
 * @returns {ChipVM[]}
 */
function chipsFor(tags, other) {
  const on = new Set(other);
  const shown = [...tags.filter((t) => !t.retired), ...tags.filter((t) => t.retired && on.has(t.code))];
  return shown.map((t) => ({
    key: chipKey(t.code),
    code: t.code,
    label: t.label,
    kind: t.kind,
    kindLabel: kindLabel(t.kind),
    glyph: kindGlyph(t.kind),
    retired: t.retired,
    pressed: on.has(t.code),
    ariaPressed: on.has(t.code) ? 'true' : 'false',
  }));
}

/**
 * One combo field (CD-4 §6.4): None, fixedOptions, then known options most recent first (first COMBO_VISIBLE
 * unless expanded, or unless the chosen one is further down).
 * @param {FieldDescriptor} desc
 * @param {string|null} selected
 * @param {string[]} known
 * @param {string|undefined} invalidText
 * @param {boolean} expanded
 * @returns {ComboVM}
 */
function comboVm(desc, selected, known, invalidText, expanded) {
  const fixed = desc.fixedOptions ?? [];
  const extra = known.filter((k) => !fixed.includes(k));
  const showAll = expanded || extra.length <= COMBO_VISIBLE || extra.indexOf(selected ?? '') >= COMBO_VISIBLE;
  const visible = showAll ? extra : extra.slice(0, COMBO_VISIBLE);
  const chips = ['', ...fixed, ...visible];
  const isChip = selected === null || fixed.includes(selected) || extra.includes(selected);
  return {
    selected,
    newText: invalidText ?? (isChip ? '' : /** @type {string} */ (selected)),
    options: chips.map((value) => {
      const checked = invalidText === undefined && (value === '' ? selected === null : value === selected);
      return { key: chipKey(value), value, label: value === '' ? 'None' : value, checked, ariaChecked: checked ? 'true' : 'false' };
    }),
    more: !showAll,
    summary: selected === null ? (desc.placeholder ?? '') : `${desc.label}: ${selected}`,
  };
}

/**
 * The Entry page view-model (CD-4 §8.3). Without ctx (e.g. before the record service is ready) only `date` is set.
 * @param {{ draft: Draft | { record: { date: IsoDate } }, ctx?: EntryContext|null, category?: Category|null,
 *           tags?: Tag[], today: IsoDate, suggestions?: Object<string, number>|null,
 *           ui?: { expanded?: Object<string, boolean>, showSaved?: boolean } }} input
 *   ctx: recordService.entryContext(draft) (CC-40); tags: the full catalogue ordered by `order`;
 *   ui.expanded: combo fields (by slug) whose More… was tapped; ui.showSaved: false hides a "Saved" left over
 *   from before the last date change (CD-4 §8.3), default true
 * @returns {EntryVM | { date: DateVM }}
 */
export function entryViewModel({ draft, ctx = null, category = null, tags = [], today, ui = {} }) {
  const date = dateViewModel(draft.record.date, today);
  if (!ctx || !category) return { date };
  const { record, invalid = {} } = /** @type {Draft} */ (draft);
  const id = category.id;
  /** @type {ColumnContext} */
  const cc = { record, derived: ctx.derived, history: ctx.history };

  /** @type {Object<string, MetricVM>} */
  const metrics = {};
  for (const d of metricDescriptors(category)) metrics[d.id] = metricVm(d, cc);

  /** @type {Object<string, FieldVM>} */
  const fields = {};
  const row = ctx.weekdayRow;
  const addField = (/** @type {FieldId} */ fieldId, /** @type {number|string|null} */ value,
    /** @type {number|string|null} */ def, /** @type {string|undefined} */ unit, /** @type {boolean} */ precise) => {
    const overridden = !!ctx.overridden[fieldId];
    fields[slug(fieldId)] = {
      overridden,
      defaultText: defaultText(def, unit, precise),
      summary: typeof value === 'number' ? formatValue(value, 'dec1') : '',
      offerReset: overridden && invalid[fieldId] === undefined,
    };
  };
  addField('baseline', record.baseline, row?.baseline ?? null, undefined, true);
  for (const f of category.entryFields) {
    if (!f.weekdayDefault) continue;
    addField(`category.${id}.${f.key}`, record.category?.[id]?.[f.key] ?? null,
      row?.category?.[id]?.[f.key] ?? null, f.unit, false);
  }

  /** @type {Object<string, ComboVM>} */
  const combos = {};
  for (const f of category.entryFields) {
    if (f.type !== 'combo') continue;
    const fieldId = `category.${id}.${f.key}`;
    const value = record.category?.[id]?.[f.key];
    combos[slug(fieldId)] = comboVm(f, typeof value === 'string' ? value : null, ctx.fieldOptions?.[f.key] ?? [],
      invalid[fieldId], !!ui.expanded?.[slug(fieldId)]);
  }

  /** @type {Object<FieldId, string>} */
  const errors = {};
  for (const issue of ctx.validation.issues) {
    if (errors[issue.field] === undefined) errors[issue.field] = issue.message;
  }

  const chipList = chipsFor(tags, record.other);
  const complete = ctx.derived.complete;
  const announce = complete
    ? metricDescriptors(category).filter((d) => d.prominent && metricGroup(d) === 'results')
      .map((d) => [metrics[d.id].label, metrics[d.id].value, metrics[d.id].note].filter(Boolean).join(' '))
      .join(', ')
    : '';

  return {
    date,
    status: statusText(ctx.save, ui.showSaved !== false),
    complete,
    metrics,
    badges: (category.dayBadges?.(cc) ?? []).map((b) => ({ id: b.id, text: b.text, warning: b.tone === 'warning' })),
    secondary: {
      low: formatValue(ctx.derived.low, 'int'),
      high: formatValue(ctx.derived.high, 'int'),
      baseline: formatValue(record.baseline, 'dec1'),
    },
    fields,
    errors,
    chips: Object.fromEntries(chipList.map((c) => [c.key, c])),
    chipList,
    combos,
    otherText: splitOther(record.other, tags).free.join(' '),
    // TODO(IT-11): tagSuggestion and the "Add as tag" line (FR-TAG-06, May).
    suggestion: { show: false, text: '', token: '' },
    canDelete: ctx.persisted,
    deleteDialog: deleteDialog(record.date),
    announce,
  };
}

/**
 * Wording of the Delete this day confirmation and its result (CD-4 §8.7, FR-SAVE-05).
 * @param {IsoDate} iso
 */
export function deleteDialog(iso) {
  const short = formatShortDate(iso);
  return {
    title: 'Delete this day?',
    body: `The record for ${short} will be removed. This can't be undone.`,
    confirmLabel: 'Delete',
    done: `Record for ${short} deleted`,
  };
}

/**
 * The info toast text when Entry stays on yesterday after midnight (CD-4 §5.6).
 * @param {IsoDate} today
 */
export function rolloverNotice(today) {
  return { text: `It's now ${formatLongDate(today)}.`, action: 'Go to today' };
}

/**
 * What the Entry page does on `app:resume` (CD-4 §5.6, D4-09).
 * 'today': it follows today and the day changed, so it opens the new today;
 * 'stay': it follows today, but shows yesterday with an incomplete record (stored or pending), so it stays on
 *         yesterday, re-pins the hash and shows the "It's now …" toast;
 * 'refresh': it is pinned and the day changed, so it stays and repaints Next and the picker's max;
 * 'none': the day did not change.
 * @param {{ following: boolean, dayChanged: boolean, shown?: IsoDate|null, today?: IsoDate|null,
 *           hasRecord?: boolean, complete?: boolean }} state
 *   shown: the displayed date; hasRecord: a record for it is stored or pending; complete: all three scores
 * @returns {'today'|'stay'|'refresh'|'none'}
 */
export function resumeAction({ following, dayChanged, shown = null, today = null, hasRecord = false, complete = false }) {
  if (!dayChanged) return 'none';
  if (!following) return 'refresh';
  if (shown && today && shown === addDays(today, -1) && hasRecord && !complete) return 'stay';
  return 'today';
}
