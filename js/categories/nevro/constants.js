// @ts-check
// Nevro literal data: ids, reserved values, limits and the NV-SET-03 / NV-IN-04 seeds (CD-3 §7).

/** @typedef {import('../../core/types.js').SeedWeekday} SeedWeekday */
/** @typedef {import('../../core/types.js').SeedTag} SeedTag */

export const NEVRO_ID = 'nevro';
export const PROGRAM_OFF = 'Off';                 // CC-22
export const CSV_OFF_TEXT = 'turned off';         // NV-CSV-03
export const UNKNOWN_LABEL = 'Unknown';           // display and group key for "no prior change" (CC-22)
export const DEFAULT_REFERENCE_LEVEL = 7;         // NV-SET-01
export const PROGRAM_MAX_LENGTH = 40;
export const ROLLING_WINDOW = 7;                  // NV-CAL-08
export const DEFAULT_PROGRAM_PATTERN = '^[A-Za-z]{2,5}\\d+( \\(\\w+\\))?$';   // NV-IMP-03

/** NV-SET-03. Baselines as exact ninths, written as expressions (CC-08). @type {ReadonlyArray<Readonly<SeedWeekday>>} */
export const SEED_WEEKDAYS = Object.freeze([
  { weekday: 'Mon', baseline: 42 / 9, values: { thcMorning: 0.4, thcAfternoon: 0.4 } },
  { weekday: 'Tue', baseline: 65 / 9, values: { thcMorning: null, thcAfternoon: null } },
  { weekday: 'Wed', baseline: 63 / 9, values: { thcMorning: null, thcAfternoon: null } },
  { weekday: 'Thu', baseline: 24 / 9, values: { thcMorning: 0.4, thcAfternoon: 0.4 } },
  { weekday: 'Fri', baseline: 43 / 9, values: { thcMorning: null, thcAfternoon: null } },
  { weekday: 'Sat', baseline: 33 / 9, values: { thcMorning: 0.4, thcAfternoon: 0.4 } },
  { weekday: 'Sun', baseline: 53 / 9, values: { thcMorning: null, thcAfternoon: null } },
].map((row) => Object.freeze({ ...row, values: Object.freeze(row.values) })));

/** NV-IN-04, in chip order. @type {ReadonlyArray<Readonly<SeedTag>>} */
export const DEFAULT_TAGS = Object.freeze([
  { code: 'P', label: 'Palexia', kind: 'treatment' },
  { code: 'N', label: 'Panadine', kind: 'treatment' },
  { code: 'A', label: 'Acupuncture', kind: 'treatment' },
  { code: 'Cod', label: 'Codeine', kind: 'treatment' },
  { code: 'Cort', label: 'Cortisone', kind: 'treatment' },
  { code: 'Q', label: 'Quilting', kind: 'positive' },
  { code: 'cold', label: 'Cold/illness', kind: 'event' },
  { code: 'Med', label: 'Medical procedure', kind: 'event' },
].map((tag) => Object.freeze(/** @type {SeedTag} */ (tag))));
