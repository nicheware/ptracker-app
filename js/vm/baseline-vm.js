// @ts-check
// Baseline view-model: weekday table, category settings, tag list, restore-defaults text, errors and the About
// panel (CD-4 §10.3).

import { weekdayName } from '../core/dates.js';
import { formatValue, kindGlyph, kindLabel, kindShortLabel, toInputText } from '../core/format.js';

/** @typedef {import('../core/types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('../core/types.js').WeekdayCode} WeekdayCode */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').Tag} Tag */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').FieldDescriptor} FieldDescriptor */

/** @typedef {{ summary: string, edit: string }} CellVM  summary at rest; edit = the full-precision input text */
/**
 * @typedef {Object} BaselineVM
 * @property {Array<{ id: string, label: string }>} columns   weekday table columns after Day: Baseline, then
 *           the category's weekdayFields; id = slug of the column's field id with the weekday left out
 * @property {Array<{ code: WeekdayCode, name: string, cells: Object<string, CellVM> }>} weekdays
 *           cells keyed by slug(FieldId), e.g. 'weekday_Mon_baseline' (CC-23 field ids)
 * @property {string} categoryTitle        `${category.name} settings`
 * @property {Object<string, CellVM & { label: string }>} settings   keyed by slug(FieldId), in descriptor order
 * @property {Array<{ code: string, label: string, kind: string, kindLabel: string, kindShort: string, glyph: string,
 *                   retired: boolean, retiredText: string, status: string, canUp: boolean, canDown: boolean }>} tags
 *           kindShort and retiredText are shown; status is the full text for VoiceOver (FR-TAG-07)
 * @property {{ title: string, body: string, confirmLabel: string }} restore   restore-defaults dialog (FR-BAS-08)
 * @property {{ name: string, version: string, recordCount: string, storage: string, storageWarn: boolean, integrity: string,
 *             quarantineWarn: boolean }} about
 * @property {Object<string, string>} errors   FieldId → message (painted by data-error)
 */

/** About-panel storage texts (CD-4 §10.3, NFR-REL-02). */
export const STORAGE_TEXT = Object.freeze({
  persistent: 'Persistent ✓',
  notPersistent: 'Not persistent ⚠ — iOS may clear PTracker\'s data when storage is low. Export a CSV regularly.',
  unsupported: 'Unknown (not supported by this browser)',
  checking: 'Checking…',
});

/**
 * @param {boolean|null|undefined} storage  persisted() result; undefined while it is pending
 * @returns {{ storage: string, storageWarn: boolean }}
 */
function storageText(storage) {
  if (storage === true) return { storage: STORAGE_TEXT.persistent, storageWarn: false };
  if (storage === false) return { storage: STORAGE_TEXT.notPersistent, storageWarn: true };
  if (storage === null) return { storage: STORAGE_TEXT.unsupported, storageWarn: false };
  return { storage: STORAGE_TEXT.checking, storageWarn: false };
}

/**
 * The About "Day records" text (CD-4 §10.3 recordCount).
 * @param {number} n
 */
function recordCountText(n) {
  if (n === 0) return 'No day records yet';
  return n === 1 ? '1 day record' : `${n} day records`;
}

/**
 * Startup-check text from the boot report (CD-4 §10.3, NFR-REL-04/05); '' before the report arrives.
 * @param {import('../core/types.js').BootReport|null|undefined} report
 */
function integrityText(report) {
  if (!report) return '';
  return `Startup check: ${report.derivedFixed} values recalculated, ${report.quarantined} records set aside `
    + `(${report.quarantineTotal} in total)`;
}

/**
 * FieldId → path-safe key: 'weekday.Mon.baseline' → 'weekday_Mon_baseline' (CD-4 §6.2 slug rule).
 * @param {string} fieldId
 */
const slug = (fieldId) => fieldId.replace(/\./g, '_');

/**
 * Text of a weekday-extension value: as entered; blank → '' (CD-4 §10.3). The unit is shown beside the control.
 * @param {unknown} value
 */
function weekdayValueCell(value) {
  const text = toInputText(/** @type {number|string|null} */ (value ?? null));
  return { summary: text, edit: text };
}

/**
 * A precise decimal (baselines, decimal settings): 1 dp at rest, full precision for editing (D4-06, FR-BAS-04).
 * @param {unknown} value
 * @param {FieldDescriptor['type']} type
 * @returns {CellVM}
 */
function preciseCell(value, type) {
  if (value == null || value === '') return { summary: '', edit: '' };
  const edit = toInputText(/** @type {number|string} */ (value));
  return { summary: type === 'decimal' && typeof value === 'number' ? formatValue(value, 'dec1') : edit, edit };
}

/**
 * Weekday table columns after Day: Baseline, then the category's weekday fields by their short heading (else
 * the label) plus the unit, so the table fits a portrait phone (CD-4 §10.1, §10.3, FR-BAS-10).
 * @param {Category} category
 * @returns {Array<{ id: string, label: string }>}
 */
export function weekdayColumns(category) {
  return [
    { id: 'baseline', label: 'Baseline' },
    ...category.weekdayFields.map((f) => {
      const heading = f.shortLabel ?? f.label;
      return { id: slug(f.key), label: f.unit ? `${heading} (${f.unit})` : heading };
    }),
  ];
}

/**
 * 'a', 'a and b', 'a, b and c'.
 * @param {string[]} items
 */
function joinAnd(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The restore-defaults confirmation, built only from descriptor labels so no framework file names a category
 * word (CD-4 §10.2, CC-38 rev 1 category-boundary).
 * @param {Category} category
 */
export function restoreDefaultsText(category) {
  const labels = ['weekday baselines', ...category.weekdayFields.map((f) => f.label),
    ...category.settingsFields.map((f) => f.label)];
  return {
    title: 'Restore defaults?',
    body: `Restore the default ${joinAnd(labels)}? Tags and day records are not changed.`,
    confirmLabel: 'Restore defaults',
  };
}

/**
 * Tags in display order: ascending order (then code), retired last (CD-4 §10.3).
 * @param {Tag[]} tags
 */
function orderedTags(tags) {
  const byOrder = (/** @type {Tag} */ a, /** @type {Tag} */ b) =>
    a.order - b.order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const active = tags.filter((t) => !t.retired).sort(byOrder);
  const retired = tags.filter((t) => t.retired).sort(byOrder);
  return [...active, ...retired];
}

/**
 * The Baseline page view-model (CD-4 §10.3).
 * @param {{ weekdays: WeekdayRow[], settings: Settings, tags: Tag[], category: Category,
 *           records?: readonly import('../core/types.js').DayRecord[], appName: string,
 *           appVersion: string, bootReport?: import('../core/types.js').BootReport|null,
 *           storage?: boolean|null, errors?: Object<string, string> }} input
 *           storage: persisted() result, undefined while pending; errors: FieldId → message
 * @returns {BaselineVM}
 */
export function baselineViewModel({ weekdays, settings, tags, category, records = [], appName, appVersion, bootReport,
  storage, errors = {} }) {
  // TODO(IT-11): renames (§10.4, NV-PRG-06).
  const id = category.id;
  const columns = weekdayColumns(category);
  const weekdayVms = weekdays.map((row) => {
    /** @type {Object<string, CellVM>} */
    const cells = { [slug(`weekday.${row.weekday}.baseline`)]: preciseCell(row.baseline, 'decimal') };
    for (const f of category.weekdayFields) {
      cells[slug(`weekday.${row.weekday}.${f.key}`)] = weekdayValueCell(row.category?.[id]?.[f.key]);
    }
    return { code: row.weekday, name: weekdayName(row.weekday), cells };
  });

  const cs = /** @type {Object<string, unknown>} */ (settings?.category?.[id] ?? {});
  /** @type {Object<string, CellVM & { label: string }>} */
  const settingsVm = {};
  for (const f of category.settingsFields) {
    settingsVm[slug(`settings.category.${id}.${f.key}`)] = { label: f.label, ...preciseCell(cs[f.key], f.type) };
  }

  const ordered = orderedTags(tags);
  const activeCount = ordered.filter((t) => !t.retired).length;
  const tagVms = ordered.map((t, i) => ({
    code: t.code,
    label: t.label,
    kind: t.kind,
    kindLabel: kindLabel(t.kind),
    kindShort: kindShortLabel(t.kind),
    glyph: kindGlyph(t.kind),
    retired: t.retired,
    retiredText: t.retired ? 'Retired' : '',
    status: `${kindLabel(t.kind)}${t.retired ? ' (retired)' : ''}`,
    canUp: !t.retired && i > 0,
    canDown: !t.retired && i < activeCount - 1,
  }));

  return {
    columns,
    weekdays: weekdayVms,
    categoryTitle: `${category.name} settings`,
    settings: settingsVm,
    tags: tagVms,
    restore: restoreDefaultsText(category),
    errors: { ...errors },
    about: {
      name: appName,
      version: appVersion,
      recordCount: recordCountText(records.length),
      ...storageText(storage),
      integrity: integrityText(bootReport),
      quarantineWarn: (bootReport?.quarantineTotal ?? 0) > 0,
    },
  };
}

/**
 * The tag dialog (CD-4 §10.1): title, edit-only parts, Move up / Move down state and the errors by slot
 * ('tag.code', 'tag.label', 'tag.kind').
 * @param {{ tag: BaselineVM['tags'][number]|null, errors?: Object<string, string> }} input   tag null = a new tag
 */
export function tagDialogViewModel({ tag, errors = {} }) {
  return {
    title: tag ? `Edit tag ${tag.code}` : 'Add tag',
    isEdit: tag !== null,
    upDisabled: !tag?.canUp,
    downDisabled: !tag?.canDown,
    errors: { ...errors },
  };
}
