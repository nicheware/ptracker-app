// @ts-check
// Nevro Comment cell ↔ program change and comment: CSV, History display and parsing (CD-3 §12.3, §13.1, §14.2).

import { CSV_OFF_TEXT, PROGRAM_MAX_LENGTH, PROGRAM_OFF } from './constants.js';
import { programLabel } from './programs.js';

/** @typedef {import('../../core/types.js').ValidationIssue} ValidationIssue */

const SEPARATOR = ' - ';

/**
 * NV-CSV-03: 'KM2', 'turned off', 'KM2 - started late', the comment alone, or null when both are empty.
 * @param {string|null|undefined} pc  programChange
 * @param {string|null|undefined} comment
 * @returns {string|null}
 */
export function formatCommentCell(pc, comment) {
  const name = pc == null ? null : pc === PROGRAM_OFF ? CSV_OFF_TEXT : pc;
  const c = comment ?? '';
  if (name && c) return name + SEPARATOR + c;
  if (name) return name;
  return c === '' ? null : c;
}

/**
 * History Comment cell (NV-HIS-02): '→ KM8', '→ KM8 - comment', the comment alone, or null.
 * @param {string|null|undefined} pc
 * @param {string|null|undefined} comment
 * @returns {string|null}
 */
export function formatCommentDisplay(pc, comment) {
  const c = comment ?? '';
  if (pc == null) return c === '' ? null : c;
  return '→ ' + programLabel(pc) + (c !== '' ? SEPARATOR + c : '');
}

/** @param {string} s */
const isOff = (s) => s.toLowerCase() === CSV_OFF_TEXT;

/**
 * A program name that passes validateNevro's name rules and the maxLength (CD-3 §8.2), normalised; else null.
 * @param {string} s
 * @returns {string|null}
 */
function asProgramName(s) {
  const t = s.trim();
  if (t === '') return null;
  if (isOff(t) || t.toLowerCase() === 'off') return PROGRAM_OFF;
  if (t.toLowerCase() === 'unknown' || t.includes(SEPARATOR) || t.length > PROGRAM_MAX_LENGTH) return null;
  return t;
}

/**
 * Splits a Comment cell into a program change and a comment (CD-3 §14.2). Pure; never throws.
 * @param {string} text
 * @param {{ pattern: RegExp|null, known: string[], mode: 'auto'|'comment'|'category' }} opts
 * @returns {{ programChange: string|null, comment: string, toggle: boolean, issue?: ValidationIssue }}
 */
export function parseCommentCell(text, { pattern, known, mode }) {
  const t = String(text ?? '').trim();
  /** @param {string} s */
  const isProgram = (s) => (pattern ? pattern.test(s) : false) || known.includes(s);
  const asComment = { programChange: null, comment: t };

  /** @type {{ programChange: string|null, comment: string }|null} */
  let asCategory = null;
  if (t !== '') {
    const i = t.indexOf(SEPARATOR);
    const left = i >= 0 ? t.slice(0, i) : t;
    const right = i >= 0 ? t.slice(i + SEPARATOR.length).trim() : '';
    const program = asProgramName(left);
    asCategory = program === null ? null : { programChange: program, comment: right };
  }

  if (mode === 'comment') return { ...asComment, toggle: true };
  if (mode === 'category') {
    return asCategory
      ? { ...asCategory, toggle: true }
      : { ...asComment, toggle: true,
        issue: { field: 'Comment', code: 'RESERVED', message: 'This text cannot be used as a program name.' } };
  }

  /** @type {{ programChange: string|null, comment: string }} */
  let r;
  const m = /^(.+?) - (.*)$/s.exec(t);
  if (t === '') r = { programChange: null, comment: '' };
  else if (isOff(t)) r = { programChange: PROGRAM_OFF, comment: '' };
  else if (isProgram(t)) r = { programChange: t, comment: '' };
  else if (m && (isOff(m[1].trim()) || isProgram(m[1].trim()))) {
    r = { programChange: isOff(m[1].trim()) ? PROGRAM_OFF : m[1].trim(), comment: m[2].trim() };
  } else r = asComment;
  return { ...r, toggle: t !== '' && (r.programChange !== null || asCategory !== null) };
}
