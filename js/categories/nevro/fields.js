// @ts-check
// Nevro settings, weekday-extension and entry field descriptors, seeds and cross-field validation (CD-3 §8).

import { isNum } from '../../core/numbers.js';
import { DEFAULT_REFERENCE_LEVEL, DEFAULT_TAGS, PROGRAM_MAX_LENGTH, PROGRAM_OFF, SEED_WEEKDAYS } from './constants.js';
import { knownPrograms } from './programs.js';

/** @typedef {import('../../core/types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('../../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../../core/types.js').ValidationIssue} ValidationIssue */
/** @typedef {import('../../core/types.js').SeedWeekday} SeedWeekday */
/** @typedef {import('../../core/types.js').SeedTag} SeedTag */

/**
 * @param {string} key
 * @param {string} label
 * @param {string} shortLabel   weekday-table heading (NV-SET-05)
 * @returns {FieldDescriptor}
 */
const thc = (key, label, shortLabel) => ({
  key, label, shortLabel, type: 'decimal', unit: 'ml', min: 0, maxDp: 2, weekdayDefault: true,
  help: 'Leave blank for none.',
});

/** @type {FieldDescriptor[]} */
export const settingsFields = [
  { key: 'referenceLevel', label: 'Nevro reference level', type: 'decimal', min: 0, max: 10, maxDp: 2,
    required: true, help: 'The established pain level in the Nevro app (usually 7.0).' },
];

/** @type {FieldDescriptor[]} */
export const weekdayFields = [thc('thcMorning', 'THC morning', 'THC m'), thc('thcAfternoon', 'THC afternoon', 'THC a')];

/** @type {FieldDescriptor[]} */
export const entryFields = [
  thc('thcMorning', 'THC morning', 'THC m'),
  thc('thcAfternoon', 'THC afternoon', 'THC a'),
  { key: 'programChange', label: 'Changing tonight to', type: 'combo', fixedOptions: [PROGRAM_OFF],
    maxLength: PROGRAM_MAX_LENGTH, placeholder: 'No change', help: 'Takes effect from tomorrow.' },
];

/** @returns {{ referenceLevel: number }} fresh default settings namespace, without schemaVersion (NV-SET-01) */
export const defaultSettings = () => ({ referenceLevel: DEFAULT_REFERENCE_LEVEL });

/**
 * Parameter snapshot for a new record (NV-SET-04); tolerates a missing or partial namespace.
 * @param {Object|null|undefined} cs  settings.category.nevro
 * @returns {{ referenceLevel: number }}
 */
export const paramsFromSettings = (cs) => {
  const r = /** @type {any} */ (cs)?.referenceLevel;
  return { referenceLevel: isNum(r) ? r : DEFAULT_REFERENCE_LEVEL };
};

/** @returns {SeedWeekday[]} fresh copies of SEED_WEEKDAYS (NV-SET-03) */
export const seedWeekdays = () => SEED_WEEKDAYS.map((s) => ({ ...s, values: { ...s.values } }));

/** @returns {SeedTag[]} fresh copies of DEFAULT_TAGS (NV-IN-04) */
export const defaultTags = () => DEFAULT_TAGS.map((t) => ({ ...t }));

const RESERVED_NAMES = new Set(['off', 'turned off', 'unknown']);

/**
 * Cross-field and semantic rules that descriptors cannot express (CD-3 §8.2). Pure; [] when valid.
 * @param {DayRecord} record
 * @returns {ValidationIssue[]}
 */
export function validateNevro(record) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const ns = record?.category?.nevro ?? {};
  const pc = ns.programChange;
  if (typeof pc === 'string') {
    if (pc !== PROGRAM_OFF && RESERVED_NAMES.has(pc.toLowerCase())) {
      issues.push({ field: 'category.nevro.programChange', code: 'RESERVED',
        message: '"Off" and "Unknown" are reserved. Choose Off from the list or use another name.' });
    } else if (pc.includes(' - ')) {
      issues.push({ field: 'category.nevro.programChange', code: 'PROGRAM_SEPARATOR',
        message: 'A program name cannot contain " - ".' });
    }
  }
  const r = ns.referenceLevel;
  if (!isNum(r) || r < 0 || r > 10) {
    issues.push({ field: 'category.nevro.referenceLevel', code: 'OUT_OF_RANGE',
      message: 'Reference level must be from 0 to 10.' });
  }
  return issues;
}

/**
 * Dynamic combo options by field key, excluding fixedOptions (CD-3 §4, §9.2).
 * @param {DayRecord[]} records  ascending
 * @returns {{ programChange: string[] }}
 */
export const fieldOptions = (records) => ({ programChange: knownPrograms(records) });
