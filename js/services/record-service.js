// @ts-check
// Record service: the record cache and the CC-40 API. Read side so far: load, all, get, openDraft, applyInput, entryContext (CD-5 §6–§7).

import { derive, deriveAll, historyAt } from '../core/engine.js';
import { weekdayOf } from '../core/dates.js';
import { createDraft, draftFromRecord, applyInput as applyToDraft, overrideFlags } from '../core/record-model.js';
import { validateDraft } from '../core/validation.js';

// TODO(IT-08): the save queue (save, flush, retry, real status/statusOf), delete, removeAll, commitBulk and reload.

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
export function createRecordService({ db, category, clock, settingsService }) {
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
    // TODO(IT-08): a pending or in-flight version of the queue comes first (FR-ENT-10).
    const rec = byDate.get(date);
    if (rec) return draftFromRecord(rec, { persisted: true });
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

  // TODO(IT-08): the queue's per-date and overall status (CD-5 §8.5).
  /** @param {IsoDate|null} date @returns {SaveStatus} */
  const idle = (date) => ({ status: 'idle', date, error: null, pendingDates: [] });

  /**
   * History values for the draft's date over the effective list: the committed cache with the draft's record
   * inserted or replaced at its date (CC-19), computed over the prefix up to that date (causal, CC-19 rev 1).
   * @param {DayRecord} record
   */
  function historyFor(record) {
    const ds = derivedCache();
    const i = lowerBound(records, record.date);
    const prefix = records.slice(0, i);
    prefix.push(record);
    const prefixDerived = ds.slice(0, i);
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
      persisted: isPersisted(record.date),
      save: idle(record.date),
    };
  }

  return {
    load,
    all,
    get,
    openDraft,
    applyInput,
    entryContext,
    fieldOptions,
    isPersisted,
    statusOf: (/** @type {IsoDate} */ date) => idle(date),
    status: () => idle(null),
  };
}
