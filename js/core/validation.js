// @ts-check
// The one per-field validator: FieldSpec, specFromDescriptor, validateField and issue messages (CD-5 §3.5, §4, CC-23).

import { isScore, parseDecimal, countDp } from './numbers.js';

/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('./types.js').FieldId} FieldId */
/** @typedef {import('./types.js').ValidationIssue} ValidationIssue */

// TODO(IT-07): validateRecord and validateDraft (CD-5 §4).

/** Issue codes (CC-23 rev 1); categories may add their own. */
export const ISSUE = Object.freeze({
  REQUIRED: 'REQUIRED', NOT_NUMBER: 'NOT_NUMBER', NOT_INTEGER: 'NOT_INTEGER', OUT_OF_RANGE: 'OUT_OF_RANGE',
  TOO_MANY_DP: 'TOO_MANY_DP', TOO_LONG: 'TOO_LONG', INVALID_DATE: 'INVALID_DATE', FUTURE_DATE: 'FUTURE_DATE',
  DUPLICATE: 'DUPLICATE', RESERVED: 'RESERVED', TOO_MANY_FIELDS: 'TOO_MANY_FIELDS',
});

/**
 * Builds a FieldSpec from a descriptor (CD-5 §4): nullable = !required; copies min, max, maxDp, maxLength,
 * fixedOptions and weekdayDefault; the label comes from the descriptor.
 * @param {FieldDescriptor} desc
 * @param {FieldId} fieldId   full path, e.g. 'category.<id>.<key>', 'settings.category.<id>.<key>', 'weekday.Mon.<key>'
 * @returns {FieldSpec}
 */
export function specFromDescriptor(desc, fieldId) {
  /** @type {FieldSpec} */
  const spec = { id: fieldId, type: desc.type, label: desc.label, nullable: !desc.required };
  if (desc.min !== undefined) spec.min = desc.min;
  if (desc.max !== undefined) spec.max = desc.max;
  if (desc.maxDp !== undefined) spec.maxDp = desc.maxDp;
  if (desc.maxLength !== undefined) spec.maxLength = desc.maxLength;
  if (desc.fixedOptions !== undefined) spec.fixedOptions = [...desc.fixedOptions];
  if (desc.weekdayDefault !== undefined) spec.weekdayDefault = desc.weekdayDefault;
  return spec;
}

/** @param {FieldSpec} spec */
const isBaseline = (spec) => spec.id === 'baseline' || spec.id.endsWith('.baseline');

/**
 * The user-facing sentence for an issue (CD-5 §4 message table).
 * @param {FieldSpec} spec
 * @param {string} code
 * @returns {string}
 */
export function issueMessage(spec, code) {
  const { label } = spec;
  if (spec.type === 'score') return 'Enter a whole number from 0 to 10.';
  if (isBaseline(spec) && (code === ISSUE.REQUIRED || code === ISSUE.NOT_NUMBER || code === ISSUE.OUT_OF_RANGE)) {
    return 'Enter a baseline from 0 to 10.';
  }
  switch (code) {
    case ISSUE.REQUIRED: return `${label}: enter a value.`;
    case ISSUE.NOT_NUMBER: return `${label}: enter a number.`;
    case ISSUE.NOT_INTEGER: return `${label}: enter a whole number.`;
    case ISSUE.TOO_MANY_DP: return `${label}: use up to ${spec.maxDp} decimal places.`;
    case ISSUE.TOO_LONG: return `${label}: use up to ${spec.maxLength} characters.`;
    case ISSUE.OUT_OF_RANGE:
      if (spec.min !== undefined && spec.max !== undefined) return `${label}: enter a number from ${spec.min} to ${spec.max}.`;
      if (spec.min !== undefined) return `${label}: enter ${spec.min} or more.`;
      return `${label}: enter ${spec.max} or less.`;
    case ISSUE.INVALID_DATE: return 'This date is not valid.';
    case ISSUE.FUTURE_DATE: return 'Future dates cannot be entered.';
    default: return `${label}: this value is not valid.`;
  }
}

/**
 * @param {FieldSpec} spec
 * @param {string} code
 * @returns {{ ok: false, issue: ValidationIssue }}
 */
const fail = (spec, code) => ({ ok: false, issue: { field: spec.id, code, message: issueMessage(spec, code) } });

/**
 * Decimal and int parse (CC-21 rev 1): '' → null (or REQUIRED); NaN → NOT_NUMBER; countDp on the text →
 * TOO_MANY_DP; min/max → OUT_OF_RANGE; then, for int, NOT_INTEGER. A number value (not typed text) skips the
 * decimal-places check.
 * @param {FieldSpec} spec
 * @param {unknown} value
 */
function parseNumber(spec, value) {
  /** @type {number|null} */
  let n;
  if (typeof value === 'number') {
    n = Number.isFinite(value) ? value : NaN;
  } else {
    const text = value == null ? '' : String(value).trim();
    if (text === '') return spec.nullable ? { ok: true, value: null } : fail(spec, ISSUE.REQUIRED);
    n = parseDecimal(text);
    if (n === null || Number.isNaN(n)) return fail(spec, ISSUE.NOT_NUMBER);
    if (spec.maxDp !== undefined && countDp(text) > spec.maxDp) return fail(spec, ISSUE.TOO_MANY_DP);
  }
  if (Number.isNaN(n)) return fail(spec, ISSUE.NOT_NUMBER);
  if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
    return fail(spec, ISSUE.OUT_OF_RANGE);
  }
  if (spec.type === 'int' && !Number.isInteger(n)) return fail(spec, ISSUE.NOT_INTEGER);
  return { ok: true, value: n === 0 ? 0 : n };
}

/**
 * The one per-field parser and checker (CC-23 rev 1; rules in CD-5 §3.5 and CC-21 rev 1). First failure wins.
 * @param {FieldSpec} spec
 * @param {unknown} value   raw input: string for typed fields, number|null for score taps, string[] for tokens
 * @returns {{ ok: true, value: any } | { ok: false, issue: ValidationIssue }}
 */
export function validateField(spec, value) {
  switch (spec.type) {
    case 'score': {
      if (value === null) return { ok: true, value: null };
      if (isScore(value)) return { ok: true, value };
      return fail(spec, typeof value === 'number' && Number.isInteger(value) ? ISSUE.OUT_OF_RANGE : ISSUE.NOT_INTEGER);
    }
    case 'decimal':
    case 'int':
      return parseNumber(spec, value);
    case 'text': {
      const text = value == null ? '' : String(value).trim();
      if (spec.id === 'comment') return { ok: true, value: text };          // framework comment stores '' (CC-11)
      if (text === '') return spec.nullable ? { ok: true, value: null } : fail(spec, ISSUE.REQUIRED);
      if (spec.maxLength !== undefined && text.length > spec.maxLength) return fail(spec, ISSUE.TOO_LONG);
      return { ok: true, value: text };
    }
    case 'combo': {
      const text = value == null ? '' : String(value).trim();
      if (text === '') return spec.nullable ? { ok: true, value: null } : fail(spec, ISSUE.REQUIRED);
      const fixed = (spec.fixedOptions ?? []).find((o) => o.toLowerCase() === text.toLowerCase());
      if (fixed !== undefined) return { ok: true, value: fixed };
      if (spec.maxLength !== undefined && text.length > spec.maxLength) return fail(spec, ISSUE.TOO_LONG);
      return { ok: true, value: text };
    }
    case 'tokens': {
      const list = Array.isArray(value) ? value : [];
      /** @type {string[]} */
      const out = [];
      for (const item of list) {
        for (const token of String(item ?? '').split(/\s+/)) {
          if (token !== '' && !out.includes(token)) out.push(token);
        }
      }
      return { ok: true, value: out };
    }
    default:
      throw new Error(`validateField: unknown field type "${spec.type}" for ${spec.id}`);
  }
}
