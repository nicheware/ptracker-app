// @ts-check
// Record service: the record cache and the CC-40 API over the save queue (CD-5 §6–§12).

import { derive, deriveAll, historyAt, withDerived } from '../core/engine.js';
import { weekdayOf } from '../core/dates.js';
import { createDraft, draftFromRecord, applyInput as applyToDraft, overrideFlags } from '../core/record-model.js';
import { validateDraft, validateRecord } from '../core/validation.js';
import { EVENTS } from '../core/events.js';
import { AppError, ERR } from '../core/errors.js';
import { createSaveQueue } from './save-queue.js';

/** @typedef {import('../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../core/types.js').Derived} Derived */
/** @typedef {import('../core/types.js').Draft} Draft */
/** @typedef {import('../core/types.js').EntryContext} EntryContext */
/** @typedef {import('../core/types.js').SaveStatus} SaveStatus */
/** @typedef {import('../core/types.js').IsoDate} IsoDate */
/** @typedef {import('../core/types.js').FieldId} FieldId */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').Clock} Clock */
/** @typedef {import('../core/types.js').SettingsService} SettingsService */
/** @typedef {import('../core/types.js').InputKind} InputKind */

/**
 * Freezes plain data recursively (CC-30: committed records are frozen).
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/**
 * Index of the first record whose date is >= date (records ascending).
 * @param {readonly DayRecord[]} records
 * @param {IsoDate} date
 */
function lowerBound(records, date) {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (records[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @param {{ db: Gateway, category: Category, clock: Clock, bus: import('../core/events.js').Emitter,
 *           settingsService: SettingsService, timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} deps
 */
export function createRecordService({ db, category, clock, bus, settingsService, timers }) {
  /** Committed records, ascending and frozen. @type {readonly DayRecord[]} */
  let records = Object.freeze([]);
  /** @type {Map<IsoDate, DayRecord>} */
  let byDate = new Map();
  /** deriveAll(records), rebuilt only when the committed cache changes (CD-5 §6.1). @type {Derived[]|null} */
  let deriveds = null;
  /** @type {Object<string, string[]>|null} */
  let options = null;

  /** @param {DayRecord[]} list */
  function setCache(list) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    records = deepFreeze(sorted);
    byDate = new Map(records.map((r) => [r.date, r]));
    deriveds = null;
    options = null;
  }

  /** Inserts or replaces one committed record (after its transaction committed, CC-30). @param {DayRecord} record */
  function upsert(record) {
    const frozen = deepFreeze(record);
    const i = lowerBound(records, frozen.date);
    const next = [...records];
    if (next[i]?.date === frozen.date) next[i] = frozen;
    else next.splice(i, 0, frozen);
    records = Object.freeze(next);
    byDate.set(frozen.date, frozen);
    deriveds = null;
    options = null;
  }

  /** @param {IsoDate} date */
  function remove(date) {
    if (!byDate.has(date)) return;
    records = Object.freeze(records.filter((r) => r.date !== date));
    byDate.delete(date);
    deriveds = null;
    options = null;
  }

  const queue = createSaveQueue({ db, category, clock, bus, timers, cache: { get: (date) => byDate.get(date) ?? null, upsert } });

  const derivedCache = () => (deriveds ??= deriveAll(/** @type {DayRecord[]} */ (records), category));

  /** Boot step 5 (CC-29): every record once, from the gateway's boot cache (CD-1 §12.3). */
  async function load() {
    setCache(/** @type {DayRecord[]} */ (await db.getAll('records')));
  }

  /** @returns {readonly DayRecord[]} */
  const all = () => records;

  /** @param {IsoDate} date @returns {DayRecord|null} */
  const get = (date) => byDate.get(date) ?? null;

  /** @param {IsoDate} date */
  const isPersisted = (date) => byDate.has(date);

  /**
   * The draft for a date (CD-5 §7.2): the stored record, else a fresh draft whose snapshot is rebuilt from the
   * current weekday row and settings on every call (CC-17 rev 1).
   * @param {IsoDate} date
   * @returns {Draft}
   */
  function openDraft(date) {
    const rec = queue.latest(date) ?? byDate.get(date);     // the queue first: the latest edit wins (FR-ENT-10)
    if (rec) return draftFromRecord(rec, { persisted: byDate.has(date) });
    return createDraft(date, {
      weekdayRow: settingsService.getWeekday(weekdayOf(date)),
      settings: settingsService.getSettings(),
      category,
      now: clock.now(),
    });
  }

  /** @param {Draft} draft @param {FieldId} fieldId @param {unknown} value @returns {Draft} */
  const applyInput = (draft, fieldId, value) => applyToDraft(draft, fieldId, value, category);

  /** category.fieldOptions(all()), memoised per cache version (NV-PRG-01). */
  const fieldOptions = () => (options ??= category.fieldOptions(/** @type {DayRecord[]} */ (records)));

  /**
   * History values for the draft's date over the effective list: the committed cache overlaid with the queue's
   * pending and in-flight records, then the draft's record at its date (CC-19), computed over the prefix up to
   * that date (causal, CC-19 rev 1).
   * @param {DayRecord} record
   */
  function historyFor(record) {
    const ds = derivedCache();
    const i = lowerBound(records, record.date);
    const prefix = records.slice(0, i);
    const prefixDerived = ds.slice(0, i);
    for (const p of queue.unsaved()) {
      if (p.date >= record.date) continue;
      const j = lowerBound(prefix, p.date);
      if (prefix[j]?.date === p.date) {
        prefix[j] = p;
        prefixDerived[j] = derive(p, category);
      } else {
        prefix.splice(j, 0, p);
        prefixDerived.splice(j, 0, derive(p, category));
      }
    }
    prefix.push(record);
    prefixDerived.push(derive(record, category));
    return historyAt(record.date, prefix, prefixDerived, category) ?? { [category.id]: {} };
  }

  /**
   * Everything the entry view-model needs besides the draft (CD-5 §6.1); cheap enough for every refresh.
   * @param {Draft} draft
   * @returns {EntryContext}
   */
  function entryContext(draft) {
    const { record } = draft;
    const weekdayRow = settingsService.getWeekday(weekdayOf(record.date));
    return {
      weekdayRow,
      derived: derive(record, category),
      history: historyFor(record),
      overridden: overrideFlags(record, weekdayRow, category),
      fieldOptions: fieldOptions(),
      validation: validateDraft(draft, category),
      persisted: isPersisted(record.date) || queue.has(record.date),
      save: queue.statusOf(record.date),
    };
  }

  /**
   * Enqueues the draft's record; never throws or rejects. Call only when the record reference changed (CC-17 rev 1).
   * @param {Draft} draft
   * @param {{ kind: InputKind }} opts
   */
  function save(draft, { kind }) {
    queue.save(draft.record, kind);
  }

  /**
   * Deletes one date's record and drops any queued save for it (CD-5 §11.1, FR-SAVE-05, CC-30 rev 1).
   * @param {IsoDate} date
   * @returns {Promise<void>}
   */
  function deleteRecord(date) {
    return queue.runExclusive(async () => {
      queue.drop([date]);
      if (byDate.has(date)) {
        await db.write([{ type: 'delete', store: 'records', key: date }]);   // one transaction (CC-39)
        remove(date);
      }
      bus.emit(EVENTS.DATA_CHANGED, { scope: 'records', dates: [date] });
      queue.emitStatus(date);                                                  // 'idle'
    });
  }

  /**
   * Deletes every record and the quarantined day records in one transaction; keeps weekdays, tags, settings and
   * other quarantine entries (CD-5 §11.2, FR-HIS-06, CC-30 rev 1, interim per CD-0 §21 Q4).
   * @returns {Promise<{ removed: number }>}
   */
  function removeAll() {
    return queue.runExclusive(async () => {
      queue.reset();
      const removed = records.length;
      const quarantine = /** @type {Array<{ id: number, store: string }>} */ (await db.getAll('quarantine'));
      await db.write([
        { type: 'clear', store: 'records' },
        ...quarantine.filter((e) => e.store === 'records').map((e) => ({ type: /** @type {'delete'} */ ('delete'), store: /** @type {'quarantine'} */ ('quarantine'), key: e.id })),
      ]);
      setCache([]);
      bus.emit(EVENTS.DATA_CHANGED, { scope: 'records', dates: null });
      queue.emitStatus(null);                                                  // 'idle'
      return { removed };
    });
  }

  /**
   * Writes complete records in one transaction (CD-5 §12, CC-40): flushes first, keeps the cached createdAt, sets
   * updatedAt, applies withDerived, and rejects with RECORD_INVALID (nothing written) if any record is invalid.
   * @param {DayRecord[]} list
   * @param {{ mode: 'skip'|'overwrite' }} opts
   * @returns {Promise<{ written: number, skipped: number }>}
   */
  async function commitBulk(list, { mode }) {
    await queue.flush();
    return queue.runExclusive(async () => {
      const now = clock.now().toISOString();
      const candidates = list
        .filter((r) => mode === 'overwrite' || !byDate.has(r.date))
        .map((r) => withDerived({ ...r, createdAt: byDate.get(r.date)?.createdAt ?? now, updatedAt: now }, category));
      for (const r of candidates) {
        const res = validateRecord(r, category);
        if (!res.ok) throw new AppError(ERR.RECORD_INVALID, `record ${r.date} failed validation`, { detail: { issues: res.issues } });
      }
      if (candidates.length === 0) return { written: 0, skipped: list.length };
      const type = mode === 'overwrite' ? 'put' : 'putIfAbsent';                // CC-39
      const result = await db.write(candidates.map((value) => ({ type, store: 'records', value })));
      const skipped = new Set(result.skipped);
      const toWrite = candidates.filter((r) => !skipped.has(r.date));
      const merged = new Map(byDate);
      for (const r of toWrite) merged.set(r.date, r);
      setCache([...merged.values()]);                                          // after commit (CC-30)
      queue.drop(toWrite.map((r) => r.date));                                  // a queued save cannot overwrite it
      bus.emit(EVENTS.DATA_CHANGED, { scope: 'records', dates: toWrite.map((r) => r.date) });
      return { written: toWrite.length, skipped: list.length - toWrite.length };
    });
  }

  /**
   * After a restore (CC-30): drops the queue and pending versions, reloads the cache, emits data:changed.
   * @returns {Promise<void>}
   */
  function reload() {
    return queue.runExclusive(async () => {
      const dropped = queue.reset();
      if (dropped.length > 0) console.warn('[ptracker:save] reload dropped pending versions', dropped);
      setCache(/** @type {DayRecord[]} */ (await db.getAll('records')));
      bus.emit(EVENTS.DATA_CHANGED, { scope: 'records', dates: null });
      queue.emitStatus(null);
    });
  }

  return {
    load,
    reload,
    all,
    get,
    openDraft,
    applyInput,
    entryContext,
    save,
    flush: queue.flush,
    retry: queue.retry,
    status: queue.status,
    statusOf: queue.statusOf,
    isPersisted,
    fieldOptions,
    delete: deleteRecord,
    removeAll,
    commitBulk,
  };
}
