// @ts-check
// Pure settings, weekday-table and tag model: seeding, repair, patches, tags and reorder (CD-1 §11.2, §11.3, CC-41).

import { SCHEMA, SETTINGS_ID } from './schema.js';
import { WEEKDAYS } from './dates.js';
import { validateField, specFromDescriptor, ISSUE } from './validation.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('./types.js').WeekdayCode} WeekdayCode */
/** @typedef {import('./types.js').Tag} Tag */
/** @typedef {import('./types.js').Timestamp} Timestamp */
/** @typedef {import('./types.js').WriteOp} WriteOp */
/** @typedef {import('./types.js').TagKind} TagKind */
/** @typedef {import('./types.js').SeedTag} SeedTag */
/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').ValidationIssue} ValidationIssue */

/** The tag kinds (CC-13), in display order. */
export const TAG_KINDS = Object.freeze(/** @type {TagKind[]} */ (['treatment', 'positive', 'event']));

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

// ── Weekday table and category settings patches (CD-1 §11.3) ───────────────────────────────────────

/**
 * The fixed framework spec of a weekday baseline (CD-1 §11.3, FR-BAS-04): 0–10, at most 4 dp accepted.
 * @param {WeekdayCode} code
 * @returns {FieldSpec}
 */
export function weekdayBaselineSpec(code) {
  return { id: `weekday.${code}.baseline`, type: 'decimal', label: 'Baseline', nullable: false, min: 0, max: 10, maxDp: 4 };
}

/**
 * The FieldSpec of a weekday-table or category-settings field ID (CC-23): 'weekday.<Mon>.baseline',
 * 'weekday.<Mon>.<key>' (category.weekdayFields) or 'settings.category.<id>.<key>' (category.settingsFields).
 * Unknown IDs are a programming error.
 * @param {string} fieldId
 * @param {Category} category
 * @returns {FieldSpec}
 */
export function settingsFieldSpec(fieldId, category) {
  const parts = fieldId.split('.');
  if (parts[0] === 'weekday' && parts.length === 3 && WEEKDAYS.includes(/** @type {WeekdayCode} */ (parts[1]))) {
    const code = /** @type {WeekdayCode} */ (parts[1]);
    if (parts[2] === 'baseline') return weekdayBaselineSpec(code);
    const desc = category.weekdayFields.find((f) => f.key === parts[2]);
    if (desc) return specFromDescriptor(desc, fieldId);
  }
  if (parts[0] === 'settings' && parts[1] === 'category' && parts[2] === category.id && parts.length === 4) {
    const desc = category.settingsFields.find((f) => f.key === parts[3]);
    if (desc) return specFromDescriptor(desc, fieldId);
  }
  throw new Error(`settingsFieldSpec: unknown field ${fieldId}`);
}

/**
 * Validates and applies a weekday-row patch. Values may be raw input strings (CC-41). Nothing changes when any
 * value is invalid.
 * @param {WeekdayRow} row
 * @param {{ baseline?: number|string, values?: Object<string, number|string|null> }} patch
 * @param {Category} category
 * @returns {{ ok: true, row: WeekdayRow } | { ok: false, issues: ValidationIssue[] }}
 */
export function applyWeekdayPatch(row, patch, category) {
  const id = category.id;
  /** @type {ValidationIssue[]} */
  const issues = [];
  let baseline = row.baseline;
  if (patch.baseline !== undefined) {
    const r = validateField(weekdayBaselineSpec(row.weekday), patch.baseline);
    if (r.ok) baseline = r.value; else issues.push(r.issue);
  }
  /** @type {Object<string, number|string|null>} */
  const values = {};
  for (const [key, raw] of Object.entries(patch.values ?? {})) {
    const r = validateField(settingsFieldSpec(`weekday.${row.weekday}.${key}`, category), raw);
    if (r.ok) values[key] = r.value; else issues.push(r.issue);
  }
  if (issues.length > 0) return { ok: false, issues };
  const ns = { schemaVersion: category.schemaVersion, ...(row.category?.[id] ?? {}), ...values };
  return { ok: true, row: { ...row, baseline, category: { ...row.category, [id]: ns } } };
}

/**
 * Validates and applies a patch to the active category's settings namespace (NV-SET-01).
 * @param {Settings} settings
 * @param {Object<string, number|string|null>} patch
 * @param {Category} category
 * @returns {{ ok: true, settings: Settings } | { ok: false, issues: ValidationIssue[] }}
 */
export function applyCategorySettingsPatch(settings, patch, category) {
  const id = category.id;
  /** @type {ValidationIssue[]} */
  const issues = [];
  /** @type {Object<string, number|string|null>} */
  const values = {};
  for (const [key, raw] of Object.entries(patch)) {
    const r = validateField(settingsFieldSpec(`settings.category.${id}.${key}`, category), raw);
    if (r.ok) values[key] = r.value; else issues.push(r.issue);
  }
  if (issues.length > 0) return { ok: false, issues };
  const ns = { schemaVersion: category.schemaVersion, ...(settings.category?.[id] ?? {}), ...values };
  return { ok: true, settings: { ...settings, category: { ...settings.category, [id]: ns } } };
}

/**
 * The weekday table and settings namespace as restoreDefaults writes them (FR-BAS-08): the seeded baselines and
 * category weekday values, and the default category settings. Other categories' namespaces are kept.
 * @param {{ settings: Settings, weekdays: WeekdayRow[] }} current
 * @param {Category} category
 * @returns {{ settings: Settings, weekdays: WeekdayRow[] }}
 */
export function restoredDefaults({ settings, weekdays }, category) {
  const id = category.id;
  const seeded = seedWeekdayRows(category);
  const rows = seeded.map((seed) => {
    const row = weekdays.find((r) => r.weekday === seed.weekday);
    return row ? { ...row, baseline: seed.baseline, category: { ...row.category, [id]: seed.category[id] } } : seed;
  });
  const ns = { schemaVersion: category.schemaVersion, ...category.defaultSettings() };
  return { settings: { ...settings, category: { ...settings.category, [id]: ns } }, weekdays: rows };
}

// ── Tags (CC-13, FR-TAG-01/03) ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} field
 * @param {string} code
 * @param {string} message
 * @returns {ValidationIssue}
 */
const tagIssue = (field, code, message) => ({ field, code, message });

/**
 * @param {string} code  the tag's code (field-ID part)
 * @param {unknown} label
 * @param {ValidationIssue[]} issues
 * @returns {string}
 */
function checkLabel(code, label, issues) {
  const r = validateField({ id: `tag.${code}.label`, type: 'text', label: 'Label', nullable: false }, label);
  if (!r.ok) issues.push(r.issue);
  return r.ok ? r.value : '';
}

/**
 * @param {string} code
 * @param {unknown} kind
 * @param {ValidationIssue[]} issues
 * @returns {TagKind}
 */
function checkKind(code, kind, issues) {
  if (TAG_KINDS.includes(/** @type {TagKind} */ (kind))) return /** @type {TagKind} */ (kind);
  issues.push(tagIssue(`tag.${code}.kind`, ISSUE.REQUIRED, 'Kind: choose Treatment, Positive or Event.'));
  return 'event';
}

/** @param {Tag[]} tags */
const nextOrder = (tags) => (tags.length === 0 ? 0 : Math.max(...tags.map((t) => t.order)) + 1);

/**
 * Validates a new tag against the catalogue (CD-1 §11.3): code non-empty after trim, no whitespace (RESERVED),
 * not used by any tag, retired included, exact case (DUPLICATE); label non-empty; kind one of the three.
 * The new tag goes last (order max + 1).
 * @param {{ code?: unknown, label?: unknown, kind?: unknown }} input
 * @param {Tag[]} existingTags
 * @returns {{ ok: true, tag: Tag } | { ok: false, issues: ValidationIssue[] }}
 */
export function makeTag(input, existingTags) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const code = input.code == null ? '' : String(input.code).trim();
  const field = `tag.${code}.code`;
  if (code === '') issues.push(tagIssue(field, ISSUE.REQUIRED, 'Code: enter a code.'));
  else if (/\s/.test(code)) issues.push(tagIssue(field, ISSUE.RESERVED, 'Code: use no spaces.'));
  else if (existingTags.some((t) => t.code === code)) {
    issues.push(tagIssue(field, ISSUE.DUPLICATE, 'Code: this code is already used (retired tags included).'));
  }
  const label = checkLabel(code, input.label, issues);
  const kind = checkKind(code, input.kind, issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, tag: { schemaVersion: SCHEMA.tag, code, label, kind, retired: false, order: nextOrder(existingTags) } };
}

/**
 * Adds several tags in list order (addTags, FR-IMP-09): codes that already exist (retired or not), or repeat an
 * earlier def, are skipped silently; any invalid def → { ok: false, issues }.
 * @param {SeedTag[]} defs
 * @param {Tag[]} existingTags
 * @returns {{ ok: true, tags: Tag[], added: string[] } | { ok: false, issues: ValidationIssue[] }}
 */
export function makeTags(defs, existingTags) {
  /** @type {Tag[]} */
  const tags = [];
  /** @type {ValidationIssue[]} */
  const issues = [];
  for (const def of defs) {
    const all = [...existingTags, ...tags];
    const code = def.code == null ? '' : String(def.code).trim();
    if (code !== '' && all.some((t) => t.code === code)) continue;
    const r = makeTag(def, all);
    if (r.ok) tags.push(r.tag); else issues.push(...r.issues);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, tags, added: tags.map((t) => t.code) };
}

/**
 * Validates and applies an edit to a tag: label, kind and retired are editable; the code is immutable (CC-13).
 * @param {Tag} tag
 * @param {{ label?: unknown, kind?: unknown, retired?: unknown }} patch
 * @returns {{ ok: true, tag: Tag } | { ok: false, issues: ValidationIssue[] }}
 */
export function applyTagPatch(tag, patch) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const next = { ...tag };
  if (patch.label !== undefined) next.label = checkLabel(tag.code, patch.label, issues);
  if (patch.kind !== undefined) next.kind = checkKind(tag.code, patch.kind, issues);
  if (patch.retired !== undefined) next.retired = patch.retired === true;
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, tag: next };
}

/**
 * New tag objects with order = index in `codes`; tags not listed keep their relative order after them. Unknown
 * codes in `codes` are ignored.
 * @param {Tag[]} tags
 * @param {string[]} codes
 * @returns {Tag[]}   all tags, in the new order
 */
export function reorder(tags, codes) {
  const byCode = new Map(tags.map((t) => [t.code, t]));
  const listed = [...new Set(codes)].filter((c) => byCode.has(c)).map((c) => /** @type {Tag} */ (byCode.get(c)));
  const rest = tags.filter((t) => !listed.includes(t))
    .sort((a, b) => a.order - b.order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return [...listed, ...rest].map((t, i) => ({ ...t, order: i }));
}
