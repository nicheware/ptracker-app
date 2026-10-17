// @ts-check
// User wording for error codes and shell notices; the single place to change it (CD-4 §5.8, CC-24).

import { isAppError } from '../core/errors.js';

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
  // Entry saves, Delete this day and Remove all (CD-4 §5.8, CD-5 §10, CD-0 RR-4)
  'save.TX_FAILED': 'Not saved. Tap to retry.',
  'save.QUOTA_EXCEEDED': 'Not saved: the phone is out of storage. Free some space, then tap to retry.',
  'save.SCHEMA_TOO_NEW': 'Not saved. A newer version is open — reload to update.',
  'save.RECORD_INVALID': 'Not saved: this entry has a problem. Please check the values.',
  RECORD_INVALID: 'This change has a problem and wasn\'t saved. Nothing was changed.',
  'delete.TX_FAILED': 'Could not delete. Nothing was changed.',
  'delete.QUOTA_EXCEEDED': 'Could not delete. Nothing was changed.',
  'removeAll.TX_FAILED': 'Could not delete. Nothing was changed.',
  'removeAll.QUOTA_EXCEEDED': 'Could not delete. Nothing was changed.',
  // CSV export (CD-6 §12)
  'export.SHARE_FAILED': 'Couldn\'t open the share sheet. Tap Download again.',
  // Baseline & settings writes (CD-4 §10.2)
  'settings.TX_FAILED': 'Not saved. Nothing was changed. Please try again.',
  UNKNOWN: 'Something went wrong. Your saved data is safe. Reload PTracker.',
});

/** Shell notices (not errors). */
export const NOTICES = Object.freeze({
  UPDATE_READY: 'A new version of PTracker is available.',
  UPDATE_HELD_BACK: 'Your last change isn\'t saved yet, so the update has been held back.',
  DB_VERSIONCHANGE: 'PTracker was updated in another window. Reload.',
  QUARANTINED: 'Some saved data couldn\'t be read and was set aside. See Baseline → About.',
  SAVED: 'Saved',
  DEFAULTS_RESTORED: 'Defaults restored',
  ALL_REMOVED: 'All day records removed',
  CSV_SAVED: 'CSV saved',
  CSV_SAVED_UNTRACKED: 'CSV saved, but PTracker couldn\'t record the download date.',
});

/** Action labels used by the shell's toasts. */
export const ACTIONS = Object.freeze({
  RELOAD: 'Reload',
  RETRY: 'Retry',
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
