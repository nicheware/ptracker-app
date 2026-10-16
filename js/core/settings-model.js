// @ts-check
// Pure settings, weekday-table and tag model: seeding and seed repair so far (CD-1 §11.2, §11.3, CC-41).

import { SCHEMA, SETTINGS_ID } from './schema.js';
import { WEEKDAYS } from './dates.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('./types.js').WeekdayCode} WeekdayCode */
/** @typedef {import('./types.js').Tag} Tag */
/** @typedef {import('./types.js').Timestamp} Timestamp */
/** @typedef {import('./types.js').WriteOp} WriteOp */
// TODO(IT-06): applyWeekdayPatch, applyCategorySettingsPatch, makeTag, makeTags, applyTagPatch, reorder (CD-1 §11.3).

/**
 * First-run settings object with the category's default namespace (CD-1 §11.2).
 * @param {Category} category
 * @param {Timestamp} now
 * @returns {Settings}
 */
export function seedSettings(category, now) {
  return {
    schemaVersion: SCHEMA.settings,
    id: 'app',
    activeCategory: category.id,
    category: { [category.id]: { schemaVersion: category.schemaVersion, ...category.defaultSettings() } },
    lastExportAt: null,
    lastBackupAt: null,
    lastExportRecordUpdatedAt: null,
    createdAt: now,
  };
}

/**
 * Weekday rows for `codes` (Mon..Sun order) from category.seedWeekdays(); baselines copied unchanged at full
 * precision (CC-08, NV-SET-03).
 * @param {Category} category
 * @param {readonly WeekdayCode[]} [codes]
 * @returns {WeekdayRow[]}
 */
export function seedWeekdayRows(category, codes = WEEKDAYS) {
  const seeds = category.seedWeekdays();
  return WEEKDAYS.filter((code) => codes.includes(code)).map((code) => {
    const seed = seeds.find((s) => s.weekday === code);
    return {
      schemaVersion: SCHEMA.weekday,
      weekday: code,
      baseline: /** @type {number} */ (seed?.baseline),
      category: { [category.id]: { schemaVersion: category.schemaVersion, ...(seed?.values ?? {}) } },
    };
  });
}

/**
 * The category's default tags as Tag objects: retired false, order = startOrder + index (CD-1 §11.2).
 * @param {Category} category
 * @param {number} [startOrder]
 * @returns {Tag[]}
 */
export function seedTags(category, startOrder = 0) {
  return category.defaultTags().map((t, i) => ({
    schemaVersion: SCHEMA.tag, code: t.code, label: t.label, kind: t.kind, retired: false, order: startOrder + i,
  }));
}

/**
 * The ops that add whatever is missing after the boot pass (CD-1 §11.2): settings, the active settings namespace,
 * weekday rows, weekday namespaces and default tags. Existing objects are never overwritten; only missing objects
 * or namespaces are added. Empty when nothing is missing.
 * @param {{ settings: Settings[], weekdays: WeekdayRow[], tags: Tag[] }} stored   as loaded (settings: 0 or 1)
 * @param {Category} category
 * @param {Timestamp} now
 * @returns {WriteOp[]}
 */
export function planSeedRepair({ settings, weekdays, tags }, category, now) {
  const id = category.id;
  /** @type {WriteOp[]} */
  const ops = [];

  const current = settings.find((s) => s.id === SETTINGS_ID);
  if (!current) {
    ops.push({ type: 'put', store: 'settings', value: seedSettings(category, now) });
  } else if (current.category?.[id] === undefined) {
    const ns = seedSettings(category, now).category[id];
    ops.push({ type: 'put', store: 'settings', value: { ...current, category: { ...current.category, [id]: ns } } });
  }

  const missingCodes = WEEKDAYS.filter((code) => !weekdays.some((r) => r.weekday === code));
  const seeded = seedWeekdayRows(category);
  for (const code of WEEKDAYS) {
    const row = weekdays.find((r) => r.weekday === code);
    const seed = /** @type {WeekdayRow} */ (seeded.find((r) => r.weekday === code));
    if (missingCodes.includes(code)) {
      ops.push({ type: 'put', store: 'weekdays', value: seed });
    } else if (row && row.category?.[id] === undefined) {
      ops.push({ type: 'put', store: 'weekdays', value: { ...row, category: { ...row.category, [id]: seed.category[id] } } });
    }
  }

  const firstRun = tags.length === 0;
  let next = firstRun ? 0 : Math.max(...tags.map((t) => t.order)) + 1;
  seedTags(category).forEach((tag, i) => {
    if (tags.some((t) => t.code === tag.code)) return;
    ops.push({ type: 'put', store: 'tags', value: { ...tag, order: firstRun ? i : next++ } });
  });
  return ops;
}
