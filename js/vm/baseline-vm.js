// @ts-check
// Baseline view-model: weekday table, category settings, tag list and About panel (CD-4 §10.3). IT-04 builds
// the read-only parts.

import { weekdayName } from '../core/dates.js';
import { formatValue, kindLabel, toInputText } from '../core/format.js';

/** @typedef {import('../core/types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('../core/types.js').WeekdayCode} WeekdayCode */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').Tag} Tag */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').FieldDescriptor} FieldDescriptor */

/** @typedef {{ summary: string }} CellVM */
/**
 * @typedef {Object} BaselineVM
 * @property {Array<{ id: string, label: string }>} columns   weekday table columns after Day: Baseline, then
 *           the category's weekdayFields; id = slug of the column's field id with the weekday left out
 * @property {Array<{ code: WeekdayCode, name: string, cells: Object<string, CellVM> }>} weekdays
 *           cells keyed by slug(FieldId), e.g. 'weekday_Mon_baseline' (CC-23 field ids)
 * @property {string} categoryTitle        `${category.name} settings`
 * @property {Object<string, CellVM & { label: string }>} settings   keyed by slug(FieldId), in descriptor order
 * @property {Array<{ code: string, label: string, kindLabel: string, glyph: string, retired: boolean,
 *                   canUp: boolean, canDown: boolean }>} tags
 * @property {{ name: string, version: string }} about
 */

/** Tag-kind glyphs (CD-4 §9 tagChip), shown with the kind label, never colour alone (NFR-USE-04). */
const KIND_GLYPHS = Object.freeze({ treatment: '▲', positive: '★', event: '●' });

/**
 * FieldId → path-safe key: 'weekday.Mon.baseline' → 'weekday_Mon_baseline' (CD-4 §6.2 slug rule).
 * @param {string} fieldId
 */
const slug = (fieldId) => fieldId.replace(/\./g, '_');

/**
 * Read-only text of a weekday-extension value: as entered plus the unit; blank → '' (CD-4 §10.3).
 * @param {unknown} value
 * @param {FieldDescriptor} desc
 */
function weekdayValueSummary(value, desc) {
  const text = toInputText(/** @type {number|string|null} */ (value ?? null));
  return text === '' ? '' : desc.unit ? `${text} ${desc.unit}` : text;
}

/**
 * Read-only text of a category setting: decimals at 1 dp (D4-06), others as entered.
 * @param {unknown} value
 * @param {FieldDescriptor} desc
 */
function settingSummary(value, desc) {
  if (value == null || value === '') return '';
  return desc.type === 'decimal' && typeof value === 'number'
    ? formatValue(value, 'dec1')
    : toInputText(/** @type {number|string} */ (value));
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
 * The Baseline page view-model (CD-4 §10.3), read-only part.
 * @param {{ weekdays: WeekdayRow[], settings: Settings, tags: Tag[], category: Category, appName: string,
 *           appVersion: string }} input
 * @returns {BaselineVM}
 */
export function baselineViewModel({ weekdays, settings, tags, category, appName, appVersion }) {
  // TODO(IT-05): about.storage, storageWarn, recordCount, integrity and quarantineWarn from records, bootReport
  // and storage.
  // TODO(IT-06): errors (inline validation) and editable cells.
  // TODO(IT-11): renames (§10.4, NV-PRG-06).
  const id = category.id;
  const columns = [
    { id: 'baseline', label: 'Baseline' },
    ...category.weekdayFields.map((f) => ({ id: slug(f.key), label: f.label })),
  ];
  const weekdayVms = weekdays.map((row) => {
    /** @type {Object<string, CellVM>} */
    const cells = { [slug(`weekday.${row.weekday}.baseline`)]: { summary: formatValue(row.baseline, 'dec1') } };
    for (const f of category.weekdayFields) {
      cells[slug(`weekday.${row.weekday}.${f.key}`)] = { summary: weekdayValueSummary(row.category?.[id]?.[f.key], f) };
    }
    return { code: row.weekday, name: weekdayName(row.weekday), cells };
  });

  const cs = /** @type {Object<string, unknown>} */ (settings?.category?.[id] ?? {});
  /** @type {Object<string, CellVM & { label: string }>} */
  const settingsVm = {};
  for (const f of category.settingsFields) {
    settingsVm[slug(`settings.category.${id}.${f.key}`)] = { label: f.label, summary: settingSummary(cs[f.key], f) };
  }

  const ordered = orderedTags(tags);
  const activeCount = ordered.filter((t) => !t.retired).length;
  const tagVms = ordered.map((t, i) => ({
    code: t.code,
    label: t.label,
    kindLabel: kindLabel(t.kind),
    glyph: KIND_GLYPHS[t.kind] ?? '',
    retired: t.retired,
    canUp: !t.retired && i > 0,
    canDown: !t.retired && i < activeCount - 1,
  }));

  return {
    columns,
    weekdays: weekdayVms,
    categoryTitle: `${category.name} settings`,
    settings: settingsVm,
    tags: tagVms,
    about: { name: appName, version: appVersion },
  };
}
