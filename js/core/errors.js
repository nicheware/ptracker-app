// @ts-check
// AppError and the error-code list (CC-24, CD-1 §5).

export class AppError extends Error {
  /**
   * @param {string} code   one of ERR
   * @param {string} [message]  developer text (never shown to the user)
   * @param {{cause?: unknown, detail?: object}} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message ?? code, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.detail = opts.detail ?? null;
  }
}

export const ERR = Object.freeze({
  DB_OPEN_FAILED: 'DB_OPEN_FAILED', DB_BLOCKED: 'DB_BLOCKED', DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  TX_FAILED: 'TX_FAILED', QUOTA_EXCEEDED: 'QUOTA_EXCEEDED', SCHEMA_TOO_NEW: 'SCHEMA_TOO_NEW',
  MIGRATION_FAILED: 'MIGRATION_FAILED', RECORD_SHAPE: 'RECORD_SHAPE', UNKNOWN_CATEGORY: 'UNKNOWN_CATEGORY',
  CSV_PARSE: 'CSV_PARSE', CSV_MISSING_COLUMNS: 'CSV_MISSING_COLUMNS', CSV_EMPTY: 'CSV_EMPTY',
  BACKUP_INVALID: 'BACKUP_INVALID', BACKUP_TOO_NEW: 'BACKUP_TOO_NEW',
  FILE_READ_FAILED: 'FILE_READ_FAILED', SHARE_FAILED: 'SHARE_FAILED', SW_REGISTER_FAILED: 'SW_REGISTER_FAILED',
  // rev 1 (CC-24 rev 1)
  CATEGORY_INVALID: 'CATEGORY_INVALID', RECORD_INVALID: 'RECORD_INVALID',
  IMPORT_STALE: 'IMPORT_STALE', FILE_TOO_LARGE: 'FILE_TOO_LARGE',
});

/** @param {unknown} e @returns {e is AppError} */
export function isAppError(e) {
  return e instanceof Error && e.name === 'AppError' && typeof (/** @type {any} */ (e).code) === 'string';
}
