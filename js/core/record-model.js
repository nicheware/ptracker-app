// @ts-check
// Draft model: createDraft, draftFromRecord, applyInput, field specs, override flags and the Other-list helpers (CD-5 §3, CC-13, CC-17).

import { SCHEMA } from './schema.js';
import { withDerived } from './engine.js';
import { todayIso } from './dates.js';
import { fieldSpec, validateField } from './validation.js';

// The framework field specs live beside the validator (no import cycle); this module is their public home (CD-5 §2).
export { FRAMEWORK_FIELDS, fieldSpec } from './validation.js';

/** @typedef {import('./types.js').DayRecord} DayRecord */
/** @typedef {import('./types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Draft} Draft */
/** @typedef {import('./types.js').FieldId} FieldId */
/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').Tag} Tag */
/** @typedef {import('./types.js').TagKind} TagKind */
/** @typedef {import('./types.js').IsoDate} IsoDate */

/**
 * Reads a record path such as 'scores.morning' or 'category.nevro.thcMorning'.
 * @param {DayRecord} record
 * @param {FieldId} fieldId
 * @returns {unknown}
 */
export function getField(record, fieldId) {
  let cur = /** @type {any} */ (record);
  for (const key of fieldId.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Immutable copy of `obj` with the value at `path` replaced (CC-06).
 * @param {any} obj
 * @param {string[]} path
 * @param {unknown} value
 * @returns {any}
 */
function setPath(obj, path, value) {
  const [head, ...rest] = path;
  return { ...obj, [head]: rest.length === 0 ? value : setPath(obj?.[head] ?? {}, rest, value) };
}

/**
 * Value equality for one field: arrays element-wise, everything else ===.
 * @param {unknown} a
 * @param {unknown} b
 */
function valueEquals(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/**
 * Builds a new, unpersisted draft for a date that has no record (CD-5 §3.4, CC-17, P3). Pure.
 * @param {IsoDate} date
 * @param {{ weekdayRow: WeekdayRow, settings: Settings, category: Category, now: Date }} ctx
 * @returns {Draft}  { record, persisted: false, invalid: {} }
 */
export function createDraft(date, { weekdayRow, settings, category, now }) {
  const id = category.id;
  const params = category.paramsFromSettings(settings?.category?.[id]);
  /** @type {Object<string, any>} */
  const ns = { schemaVersion: category.schemaVersion };
  for (const f of category.entryFields) {
    ns[f.key] = f.weekdayDefault ? (weekdayRow?.category?.[id]?.[f.key] ?? null) : null;
  }
  const ts = now.toISOString();
  /** @type {DayRecord} */
  const record = {
    schemaVersion: SCHEMA.record,
    date,
    scores: { morning: null, afternoon: null, evening: null },
    other: [],
    comment: '',
    baseline: weekdayRow?.baseline ?? null,                       // full precision, never rounded (CC-08)
    derived: { complete: false, average: null, low: null, high: null },
    category: { [id]: { ...ns, ...params, derived: {} } },
    createdAt: ts,
    updatedAt: ts,
  };
  return { record: withDerived(record, category), persisted: false, invalid: {} };
}

/**
 * Wraps a stored (or pending) record for editing.
 * @param {DayRecord} record
 * @param {{ persisted: boolean }} opts
 * @returns {Draft}
 */
export function draftFromRecord(record, { persisted }) {
  return { record, persisted, invalid: {} };
}

/**
 * Applies one control value to the draft (CD-5 §3.5). Pure. Invalid or unchanged input returns a draft with the
 * SAME record object, so callers save only when `next.record !== draft.record` (CC-17 rev 1).
 * @param {Draft} draft
 * @param {FieldId} fieldId
 * @param {unknown} value  number|null for score taps; string for typed fields; string[] for 'other'
 * @param {Category} category
 * @returns {Draft}
 */
export function applyInput(draft, fieldId, value, category) {
  const spec = fieldSpec(fieldId, category);
  const parsed = validateField(spec, value);
  const keepRaw = () => ({ ...draft, invalid: { ...draft.invalid, [fieldId]: String(value ?? '') } });
  if (!parsed.ok) return keepRaw();
  const candidate = setPath(draft.record, fieldId.split('.'), parsed.value);
  const cross = (category.validate?.(candidate) ?? []).filter((i) => i.field === fieldId);
  if (cross.length > 0) return keepRaw();
  const { [fieldId]: _, ...invalid } = draft.invalid;
  if (valueEquals(getField(draft.record, fieldId), parsed.value)) return { ...draft, invalid };
  return { ...draft, record: withDerived(candidate, category), invalid };
}

/**
 * True where the record differs (===) from the CURRENT weekday row (CD-5 §3.6, FR-BAS-07; CD-0 §21 Q8).
 * @param {DayRecord} record
 * @param {WeekdayRow} weekdayRow
 * @param {Category} category
 * @returns {Object<FieldId, boolean>}
 */
export function overrideFlags(record, weekdayRow, category) {
  const id = category.id;
  /** @type {Object<FieldId, boolean>} */
  const flags = { baseline: record.baseline !== weekdayRow?.baseline };
  for (const f of category.entryFields) {
    if (!f.weekdayDefault) continue;
    flags[`category.${id}.${f.key}`] = (record.category?.[id]?.[f.key] ?? null) !== (weekdayRow?.category?.[id]?.[f.key] ?? null);
  }
  return flags;
}

/**
 * The weekday-table value of 'baseline' or a weekdayDefault field, for "reset to default" (CD-5 §3.3).
 * @param {FieldId} fieldId
 * @param {WeekdayRow} weekdayRow
 * @param {Category} category
 * @returns {number|string|null}
 */
export function defaultValueFor(fieldId, weekdayRow, category) {
  if (fieldId === 'baseline') return weekdayRow?.baseline ?? null;
  const prefix = `category.${category.id}.`;
  const key = fieldId.startsWith(prefix) ? fieldId.slice(prefix.length) : null;
  const desc = key === null ? undefined : category.entryFields.find((f) => f.key === key);
  if (!desc?.weekdayDefault) throw new Error(`defaultValueFor: "${fieldId}" has no weekday default`);
  return weekdayRow?.category?.[category.id]?.[/** @type {string} */ (key)] ?? null;
}

// ── Other-list helpers (CC-13 rev 1): the only implementations ─────────────────────────────────────

/**
 * Appends the code when absent, removes it when present; other tokens keep their positions.
 * @param {string[]} other
 * @param {string} code
 * @returns {string[]}
 */
export function toggleTag(other, code) {
  return other.includes(code) ? other.filter((t) => t !== code) : [...other, code];
}

/**
 * Keeps tag tokens in place, drops the free-text tokens and appends the tokens of `text` (CD-5 §3.5).
 * A typed token that is a catalogue code becomes a tag (CC-13); duplicates are removed later by applyInput.
 * @param {string[]} other
 * @param {string} text
 * @param {(token: string) => boolean} isTagCode
 * @returns {string[]}
 */
export function setFreeText(other, text, isTagCode) {
  const typed = String(text ?? '').split(/\s+/).filter((t) => t !== '');
  return [...other.filter((t) => isTagCode(t)), ...typed];
}

/**
 * Classifies tokens on read (CC-13): a token is a tag when a catalogue entry (retired or not) has that code.
 * @param {string[]} other
 * @param {Tag[]} tags
 * @returns {{ tags: string[], free: string[] }}  each in token order
 */
export function splitOther(other, tags) {
  const codes = new Set(tags.map((t) => t.code));
  return { tags: other.filter((t) => codes.has(t)), free: other.filter((t) => !codes.has(t)) };
}

/**
 * The tag kinds present on a record's Other list; retired tags count (CC-13 rev 1).
 * @param {string[]} other
 * @param {Tag[]} tags
 * @returns {Set<TagKind>}
 */
export function tagKindsOf(other, tags) {
  const byCode = new Map(tags.map((t) => [t.code, t.kind]));
  /** @type {Set<TagKind>} */
  const kinds = new Set();
  for (const token of other) {
    const kind = byCode.get(token);
    if (kind) kinds.add(kind);
  }
  return kinds;
}

/**
 * Deep equality of plain data.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
}

/**
 * Inputs without the stored derived copies and timestamps.
 * @param {DayRecord} r
 */
function inputsOf(r) {
  const { derived: _d, createdAt: _c, updatedAt: _u, category, ...rest } = r;
  /** @type {Object<string, any>} */
  const cats = {};
  for (const [id, ns] of Object.entries(category ?? {})) {
    const { derived: _nd, ...keys } = ns ?? {};
    cats[id] = keys;
  }
  return { ...rest, category: cats };
}

/**
 * True if two records have equal inputs and snapshots (ignores derived, createdAt, updatedAt).
 * @param {DayRecord} a
 * @param {DayRecord} b
 * @returns {boolean}
 */
export function inputsEqual(a, b) {
  return deepEqual(inputsOf(a), inputsOf(b));
}

/**
 * @param {IsoDate} date
 * @param {Date} now
 * @returns {boolean} date > todayIso(now)
 */
export function isFutureDate(date, now) {
  return date > todayIso(now);
}
