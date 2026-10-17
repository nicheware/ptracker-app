// @ts-check
// Transfer service, M1 part: the CSV file built synchronously from the caches, the export inside the tap and
// last-export tracking (CD-6 §6, §10, CC-42). Import, backup, restore and the reminder are M2.

import { recordsToCsv } from '../core/csv-mapping.js';
import { todayIso } from '../core/dates.js';
import { EVENTS } from '../core/events.js';

/** @typedef {import('../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Clock} Clock */
/** @typedef {import('../core/types.js').FileOut} FileOut */
/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').SettingsService} SettingsService */
/** @typedef {import('../core/types.js').CsvExportOptions} CsvExportOptions */
/** @typedef {import('../core/types.js').ExportFile} ExportFile */
/** @typedef {import('../core/types.js').ExportResult} ExportResult */
/** @typedef {import('../core/types.js').TransferService} TransferService */

/**
 * FR-EXP-05: ptracker-<category>-<local YYYY-MM-DD>.csv (CD-6 §6.1, CC-07).
 * @param {Category} category
 * @param {Date} now
 */
export function csvFileName(category, now) {
  return `ptracker-${category.csv.fileId}-${todayIso(now)}.csv`;
}

/**
 * The latest updatedAt over all records, or null (Timestamps are ISO strings, so they compare as text).
 * @param {readonly DayRecord[]} records
 * @returns {string|null}
 */
export function maxUpdatedAt(records) {
  let max = null;
  for (const r of records) if (r.updatedAt && (max === null || r.updatedAt > max)) max = r.updatedAt;
  return max;
}

/**
 * @param {{ db?: Gateway, category: Category, clock: Clock, bus: import('../core/events.js').Emitter, fileOut: FileOut,
 *           recordService: { all(): readonly DayRecord[] }, settingsService: SettingsService, appVersion?: string }} deps
 *        db and appVersion are used by the M2 backup functions (CC-28)
 * @returns {TransferService}
 */
export function createTransferService({ category, clock, bus, fileOut, recordService, settingsService }) {
  /** @type {TransferService['csvFile']} */
  function csvFile(opts) {
    const records = recordService.all();                                   // CC-30, ascending
    const { text, rowCount } = recordsToCsv(records, category, opts);
    return { name: csvFileName(category, clock.now()), type: 'text/csv', text, rowCount, maxUpdatedAt: maxUpdatedAt(records) };
  }

  /**
   * FR-EXP-07: never rejects; a failure here does not undo a saved file.
   * @param {'csv'|'backup'} kind
   * @param {string|null} maxUpdated
   * @returns {Promise<Error|null>}
   */
  async function recordExport(kind, maxUpdated) {
    const at = clock.now().toISOString();
    try {
      await settingsService.markExported(kind, at, maxUpdated);
    } catch (err) {
      console.warn('[ptracker:export] export tracking failed', err);
      return err instanceof Error ? err : new Error(String(err));
    }
    bus.emit(EVENTS.EXPORT_DONE, { kind, at });
    return null;
  }

  /**
   * Call inside the tap handler. Never awaits before fileOut.save (CC-27 rev 1), hence written with .then.
   * @type {TransferService['exportCsv']}
   */
  function exportCsv(opts) {
    const file = csvFile(opts);
    return fileOut.save(file).then(async (outcome) => {
      if (outcome === 'cancelled') return { outcome, rowCount: file.rowCount, trackingError: null };
      const trackingError = await recordExport('csv', file.maxUpdatedAt);
      return { outcome, rowCount: file.rowCount, trackingError };
    });
  }

  return { csvFile, exportCsv };
}
