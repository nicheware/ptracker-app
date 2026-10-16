// @ts-check
// The Nevro category object (CC-20 rev 1): descriptors plus pure functions, frozen (CD-3 §2, §4).

import { NEVRO_ID, PROGRAM_OFF, DEFAULT_PROGRAM_PATTERN } from './constants.js';
import {
  settingsFields, weekdayFields, entryFields, defaultSettings, paramsFromSettings, seedWeekdays, defaultTags,
  validateNevro, fieldOptions,
} from './fields.js';
import { DERIVED_KEYS, HISTORY_KEYS, deriveRecord, historyMetrics } from './metrics.js';
import { displayMetrics, historyColumns, dayBadges } from './display.js';
import { csvStandard, csvExtended } from './csv.js';

export { NEVRO_ID, PROGRAM_OFF, DEFAULT_PROGRAM_PATTERN };

/** @typedef {import('../../core/types.js').Category} Category */

/**
 * Freezes objects and arrays recursively; functions are left as they are.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** @type {Category} */
export const nevro = deepFreeze({
  id: NEVRO_ID,
  name: 'Nevro',
  schemaVersion: 1,
  migrations: [],                       // CD-3 §16: none at schemaVersion 1
  // (1) settings
  settingsFields,
  defaultSettings,
  paramsFromSettings,
  // (2) weekday extension
  weekdayFields,
  seedWeekdays,
  // (3) tags
  defaultTags,
  // (4) entry fields and validation
  entryFields,
  validate: validateNevro,
  fieldOptions,
  // (5) per-record metrics
  deriveRecord,
  derivedKeys: [...DERIVED_KEYS],
  // (6) display metrics and badges
  displayMetrics,
  dayBadges,
  // (7) history
  historyColumns,
  historyMetrics,
  historyKeys: [...HISTORY_KEYS],
  // (8) CSV
  csv: { fileId: NEVRO_ID, standard: csvStandard, extended: csvExtended },
  // M2 group (chart, groupKey, mainMetric, importRules) is absent in M1 (CC-20 rev 1).
});
