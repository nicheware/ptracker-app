// @ts-check
// Pure settings, weekday-table and tag model: seeding so far (CD-1 §11.3, CC-41).

import { SCHEMA } from './schema.js';
import { WEEKDAYS } from './dates.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('./types.js').WeekdayCode} WeekdayCode */
/** @typedef {import('./types.js').Tag} Tag */
/** @typedef {import('./types.js').Timestamp} Timestamp */

// TODO(IT-05): planSeedRepair (CD-1 §11.2).
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
