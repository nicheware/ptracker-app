// @ts-check
// User wording for error codes and shell notices; the single place to change it (CD-4 §5.8, CC-24).

import { isAppError } from '../core/errors.js';

// The save, delete, removeAll, export and settings contexts arrive with their pages (IT-06..IT-10).

/** '<context>.<CODE>' or '<CODE>' → sentence. */
export const MESSAGES = Object.freeze({
  // Fatal screen and storage (CD-4 §5.8, CC-29 rev 1)
  DB_OPEN_FAILED: 'PTracker can\'t open its storage on this device. If you are in a private browsing window, open PTracker normally.',
  DB_UNAVAILABLE: 'PTracker can\'t open its storage on this device. If you are in a private browsing window, open PTracker normally.',
  DB_BLOCKED: 'PTracker is open in another tab or window. Close it and reload.',
  SCHEMA_TOO_NEW: 'Your data was saved by a newer version of PTracker. Reload to get the update.',
  UNKNOWN_CATEGORY: 'PTracker\'s data was set up for a diary type this version doesn\'t have. Reload to get the update. Nothing was changed.',
  CATEGORY_INVALID: 'This version of PTracker has a setup problem and can\'t start. Nothing was changed. Reload, or reinstall when an update is available.',
  TX_FAILED: 'PTracker couldn\'t write to its storage. Nothing was changed. Please try again.',
  QUOTA_EXCEEDED: 'The device is out of storage. Free some space, then try again.',
  UNKNOWN: 'Something went wrong. Your saved data is safe. Reload PTracker.',
});

/** Shell notices (not errors). */
export const NOTICES = Object.freeze({
  UPDATE_READY: 'A new version of PTracker is available.',
  UPDATE_HELD_BACK: 'Your last change isn\'t saved yet, so the update has been held back.',
  DB_VERSIONCHANGE: 'PTracker was updated in another window. Reload.',
  QUARANTINED: 'Some saved data couldn\'t be read and was set aside. See Baseline → About.',
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
