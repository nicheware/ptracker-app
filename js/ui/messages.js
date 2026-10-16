// @ts-check
// User wording for error codes and shell notices; the single place to change it (CD-4 §5.8, CC-24).

import { isAppError } from '../core/errors.js';

// TODO(IT-05): fatal-screen and storage wording (DB_*, SCHEMA_TOO_NEW, UNKNOWN_CATEGORY, CATEGORY_INVALID,
// TX_FAILED, QUOTA_EXCEEDED). The save, delete, removeAll, export and settings contexts arrive with their pages.

/** '<context>.<CODE>' or '<CODE>' → sentence. */
export const MESSAGES = Object.freeze({
  UNKNOWN: 'Something went wrong. Your saved data is safe. Reload PTracker.',
});

/** Shell notices (not errors). */
export const NOTICES = Object.freeze({
  UPDATE_READY: 'A new version of PTracker is available.',
  UPDATE_HELD_BACK: 'Your last change isn\'t saved yet, so the update has been held back.',
  DB_VERSIONCHANGE: 'PTracker was updated in another window. Reload.',
});

/** Action labels used by the shell's toasts. */
export const ACTIONS = Object.freeze({
  RELOAD: 'Reload',
});

/**
 * @param {unknown} err
 * @param {'save'|'delete'|'removeAll'|'export'|'import'|'restore'|'settings'} [context]
 * @returns {string}
 */
export function messageFor(err, context) {
  /** @type {Record<string, string>} */
  const table = MESSAGES;
  if (!isAppError(err)) return table.UNKNOWN;
  return (context && table[`${context}.${err.code}`]) ?? table[err.code] ?? table.UNKNOWN;
}
