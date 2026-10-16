// @ts-check
// Save queue: serialised, coalescing record writes with debounce, flush, retry and exclusive operations (CD-5 §8–§9).

import { EVENTS } from '../core/events.js';
import { AppError, ERR } from '../core/errors.js';
import { withDerived } from '../core/engine.js';
import { todayIso } from '../core/dates.js';
import { inputsEqual, isFutureDate } from '../core/record-model.js';
import { validateRecord } from '../core/validation.js';

/** @typedef {import('../core/types.js').DayRecord} DayRecord */
/** @typedef {import('../core/types.js').IsoDate} IsoDate */
/** @typedef {import('../core/types.js').InputKind} InputKind */
/** @typedef {import('../core/types.js').SaveStatus} SaveStatus */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').Clock} Clock */
/** @typedef {{ setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void }} Timers */

/** Debounce and retry policy (CD-5 §9, CD-0 §19). */
export const TEXT_DEBOUNCE_MS = 400;
export const TEXT_MAX_WAIT_MS = 2000;
export const TAP_DELAY_MS = 0;
export const RETRY_DELAYS_MS = Object.freeze([2000, 10000, 30000]);
/** Codes that an automatic retry cannot fix (CD-5 §9.4, CD-0 RR-4). */
const NO_AUTO_RETRY = new Set([ERR.QUOTA_EXCEEDED, ERR.SCHEMA_TOO_NEW]);
/** Status order, worst first (CC-25 rev 1). */
const RANK = Object.freeze({ error: 4, saving: 3, pending: 2, saved: 1, idle: 0 });

/** Real timers looked up at call time, so node:test mock timers apply (CC-04). @type {Timers} */
const DEFAULT_TIMERS = Object.freeze({
  setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
  clearTimeout: (/** @type {any} */ handle) => clearTimeout(handle),
});

/**
 * @param {{ db: Gateway, category: Category, clock: Clock, bus: import('../core/events.js').Emitter,
 *           timers?: Timers,
 *           cache: { get(date: IsoDate): DayRecord|null, upsert(record: DayRecord): void } }} deps
 */
export function createSaveQueue({ db, category, clock, bus, timers = DEFAULT_TIMERS, cache }) {
  /** Latest unsaved version per date (insertion order = write order). @type {Map<IsoDate, DayRecord>} */
  const pending = new Map();
  /** Dates still debouncing. @type {Map<IsoDate, { timer: any, since: number }>} */
  const waiting = new Map();
  /** @type {{ date: IsoDate, record: DayRecord, base: DayRecord }|null} */
  let inflight = null;
  /** Last failure per date, cleared on commit. @type {Map<IsoDate, AppError>} */
  const errors = new Map();
  /** @type {{ timer: any, attempt: number }|null} */
  let retry = null;
  /** Running or queued exclusive operations. */
  let exclusive = 0;
  /** @type {Promise<unknown>} */
  let exclusiveChain = Promise.resolve();
  /** While errors exist, pump writes only after a user or timer trigger (CD-5 §9.4). */
  let retryRequested = false;
  /** Dates committed by this session with nothing newer (status 'saved'). @type {Set<IsoDate>} */
  const saved = new Set();
  /** Dates tried by each active flush. @type {Set<Set<IsoDate>>} */
  const flushes = new Set();
  /** Checks run after every write settles. @type {Set<() => void>} */
  const waiters = new Set();
  /** Resolvers waiting for the in-flight write to settle. @type {Array<() => void>} */
  let inflightWaiters = [];
  /** Last emitted status key per date. @type {Map<IsoDate|null, string>} */
  const emitted = new Map();

  const nowMs = () => clock.now().getTime();

  // ── Status (CD-5 §8.5) ──────────────────────────────────────────────────────────────────────────────

  /** @returns {IsoDate[]} */
  function pendingDates() {
    const dates = [...pending.keys()];
    if (inflight && !pending.has(inflight.date)) dates.push(inflight.date);
    return dates;
  }

  /** @param {IsoDate|null} date @returns {SaveStatus} */
  function statusOf(date) {
    const pendingList = pendingDates();
    if (date !== null) {
      const err = errors.get(date);
      if (err) return { status: 'error', date, error: err, pendingDates: pendingList };
      if (inflight?.date === date) return { status: 'saving', date, error: null, pendingDates: pendingList };
      if (pending.has(date)) return { status: 'pending', date, error: null, pendingDates: pendingList };
      if (saved.has(date)) return { status: 'saved', date, error: null, pendingDates: pendingList };
    }
    return { status: 'idle', date, error: null, pendingDates: pendingList };
  }

  /** The worst state over all dates (error > saving > pending > saved > idle). @returns {SaveStatus} */
  function status() {
    /** @type {SaveStatus} */
    let worst = statusOf(null);
    const dates = new Set([...errors.keys(), ...pendingDates(), ...saved]);
    for (const date of dates) {
      const s = statusOf(date);
      if (RANK[s.status] > RANK[worst.status]) worst = s;
    }
    return worst;
  }

  /** Emits save:status for a date only when its value changed (CD-5 §8.5). @param {IsoDate|null} date */
  function emitStatus(date) {
    const s = statusOf(date);
    const key = `${s.status}|${s.error?.code ?? ''}`;
    if (emitted.get(date) === key) return;
    if (s.status === 'idle') emitted.delete(date);
    else emitted.set(date, key);
    bus.emit(EVENTS.SAVE_STATUS, { date, status: s.status, error: s.error });
  }

  // ── Waiters ─────────────────────────────────────────────────────────────────────────────────────────

  /** Runs the registered checks on a microtask, so a check that pumps never re-enters itself (CD-5 §9.3). */
  function settleWaiters() {
    queueMicrotask(() => {
      for (const check of [...waiters]) check();
    });
  }

  function releaseInflightWaiters() {
    const list = inflightWaiters;
    inflightWaiters = [];
    for (const resolve of list) resolve();
  }

  /** @returns {Promise<void>} */
  function inflightSettled() {
    if (!inflight) return Promise.resolve();
    return new Promise((resolve) => { inflightWaiters.push(resolve); });
  }

  // ── Writing (CD-5 §8.3) ─────────────────────────────────────────────────────────────────────────────

  /** @param {IsoDate} date */
  const isReady = (date) => pending.has(date) && !waiting.has(date);

  /**
   * Starts the next write, synchronously up to db.write (CC-39).
   * @param {IsoDate} [preferred]  write this date first when it is ready
   */
  function pump(preferred) {
    if (inflight || exclusive > 0) return;
    if (errors.size > 0 && !retryRequested) {
      settleWaiters();
      return;
    }
    let date = preferred !== undefined && isReady(preferred) ? preferred : undefined;
    if (date === undefined) {
      for (const d of pending.keys()) {
        if (!waiting.has(d)) { date = d; break; }
      }
    }
    if (date === undefined) {
      settleWaiters();
      return;
    }
    const base = /** @type {DayRecord} */ (pending.get(date));
    pending.delete(date);
    for (const attempted of flushes) attempted.add(date);
    const prepared = prepare(base);
    if (!prepared.ok) {
      console.warn('[ptracker:save] record invalid', date, prepared.issues);
      errors.set(date, new AppError(ERR.RECORD_INVALID, `record ${date} failed validation`, { detail: { issues: prepared.issues } }));
      saved.delete(date);
      emitStatus(date);
      settleWaiters();
      return;
    }
    const prev = cache.get(date);
    if (prev && inputsEqual(prepared.record, prev)) {        // idempotent: no updatedAt bump (CD-5 §8.1)
      errors.delete(date);
      emitStatus(date);
      pump();
      return;
    }
    inflight = { date, record: prepared.record, base };
    emitStatus(date);                                       // 'saving'
    db.write([{ type: 'put', store: 'records', value: prepared.record }]).then(onCommit, onFail);
  }

  /**
   * Stamps timestamps and derived copies, then validates (CC-11 rev 1, CC-16).
   * @param {DayRecord} base
   * @returns {{ ok: true, record: DayRecord } | { ok: false, issues: import('../core/types.js').ValidationIssue[] }}
   */
  function prepare(base) {
    const now = clock.now();
    const stamp = now.toISOString();
    const prev = cache.get(base.date);
    const record = withDerived({ ...base, createdAt: prev ? prev.createdAt : stamp, updatedAt: stamp }, category);
    const res = validateRecord(record, category, { today: todayIso(now) });
    return res.ok ? { ok: true, record } : { ok: false, issues: res.issues };
  }

  function onCommit() {
    const { date, record } = /** @type {NonNullable<typeof inflight>} */ (inflight);
    cache.upsert(record);
    errors.delete(date);
    resetRetry();
    inflight = null;
    if (!pending.has(date)) saved.add(date);
    bus.emit(EVENTS.DATA_CHANGED, { scope: 'records', dates: [date] });
    emitStatus(date);                                       // 'saved' unless a newer version is pending
    releaseInflightWaiters();
    settleWaiters();
    pump();
  }

  /** @param {unknown} err */
  function onFail(err) {
    const { date, base } = /** @type {NonNullable<typeof inflight>} */ (inflight);
    const error = err instanceof AppError ? err : new AppError(ERR.TX_FAILED, 'save failed', { cause: err });
    console.warn('[ptracker:save] write failed', date, error.code);
    if (!pending.has(date)) pending.set(date, base);       // keep the latest version
    errors.set(date, error);
    saved.delete(date);
    inflight = null;
    retryRequested = false;
    emitStatus(date);                                       // 'error'
    scheduleRetry(error);
    releaseInflightWaiters();
    settleWaiters();
  }

  // ── Debounce and retry (CD-5 §9.2, §9.4) ────────────────────────────────────────────────────────────

  /** @param {IsoDate} date */
  function scheduleWaiting(date) {
    const w = waiting.get(date);
    const now = nowMs();
    if (w) timers.clearTimeout(w.timer);
    const since = w ? w.since : now;
    const delay = Math.min(TEXT_DEBOUNCE_MS, Math.max(0, since + TEXT_MAX_WAIT_MS - now));
    waiting.set(date, {
      since,
      timer: timers.setTimeout(() => {
        waiting.delete(date);
        pump(date);
      }, delay),
    });
  }

  /** @param {IsoDate} date */
  function clearWaiting(date) {
    const w = waiting.get(date);
    if (w) timers.clearTimeout(w.timer);
    waiting.delete(date);
  }

  /** @param {AppError} error */
  function scheduleRetry(error) {
    if (NO_AUTO_RETRY.has(error.code) || error.code === ERR.RECORD_INVALID) return;
    if (retry?.timer) return;                               // one already scheduled
    const attempt = retry?.attempt ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length) return;         // schedule used up: wait for the user
    retry = {
      attempt: attempt + 1,
      timer: timers.setTimeout(() => {
        if (retry) retry.timer = null;
        retryRequested = true;
        pump();
      }, RETRY_DELAYS_MS[attempt]),
    };
  }

  function resetRetry() {
    if (retry?.timer) timers.clearTimeout(retry.timer);
    retry = null;
  }

  // ── Public operations ───────────────────────────────────────────────────────────────────────────────

  /**
   * Enqueues the whole record for its date; never throws (CD-5 §8.3).
   * @param {DayRecord} record
   * @param {InputKind} kind
   */
  function save(record, kind) {
    const date = record.date;
    if (isFutureDate(date, clock.now())) {                  // the router prevents this (CC-31)
      console.warn('[ptracker:save] future date ignored', date);
      return;
    }
    pending.set(date, record);                              // coalesce: last write wins
    saved.delete(date);
    retryRequested = true;
    if (kind === 'tap') {
      clearWaiting(date);
      emitStatus(date);
      pump(date);
    } else {
      scheduleWaiting(date);
      emitStatus(date);
    }
  }

  /**
   * Writes everything pending now; each date is tried at most once. Never rejects (CD-5 §9.3, CC-25 rev 1).
   * @returns {Promise<void>}
   */
  function flush() {
    for (const date of [...waiting.keys()]) clearWaiting(date);
    /** @type {Set<IsoDate>} */
    const attempted = new Set();
    flushes.add(attempted);
    retryRequested = true;
    pump();                                                 // starts db.write synchronously (CC-39)
    return new Promise((resolve) => {
      const check = () => {
        if (inflight || exclusive > 0) return;
        // Dates that started debouncing after this flush began are not its concern.
        const next = [...pending.keys()].find((d) => !attempted.has(d) && !waiting.has(d));
        if (next !== undefined) {
          retryRequested = true;
          pump(next);                                       // marks next attempted; ends in a write or settleWaiters
          return;
        }
        if (errors.size > 0) retryRequested = false;
        waiters.delete(check);
        flushes.delete(attempted);
        resolve();
      };
      waiters.add(check);
      settleWaiters();
    });
  }

  /** Manual retry from the save-error toast: resets the schedule, then flushes (CD-5 §9.4). */
  function retryNow() {
    resetRetry();
    return flush();
  }

  /**
   * Runs fn on the serial lane after any in-flight write; saves made meanwhile are written afterwards (CD-5 §8.4).
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function runExclusive(fn) {
    exclusive++;
    const run = exclusiveChain.then(async () => {
      await inflightSettled();
      try {
        return await fn();
      } finally {
        exclusive--;
        pump();
        settleWaiters();
      }
    });
    exclusiveChain = run.catch(() => {});
    return run;
  }

  /**
   * Drops queued versions, errors and the saved mark for the dates (delete, commitBulk: CC-30 rev 1).
   * @param {Iterable<IsoDate>} dates
   */
  function drop(dates) {
    for (const date of dates) {
      clearWaiting(date);
      pending.delete(date);
      errors.delete(date);
      saved.delete(date);
    }
    if (errors.size === 0) resetRetry();
  }

  /** Clears every timer, pending version and error (CD-5 §8.6); returns the dates dropped. */
  function reset() {
    for (const date of [...waiting.keys()]) clearWaiting(date);
    resetRetry();
    const dropped = [...pending.keys()];
    pending.clear();
    errors.clear();
    saved.clear();
    emitted.clear();
    retryRequested = false;
    return dropped;
  }

  return {
    save,
    flush,
    retry: retryNow,
    status,
    statusOf: (/** @type {IsoDate} */ date) => statusOf(date),
    emitStatus,
    runExclusive,
    drop,
    reset,
    /** The pending or in-flight version of a date, if any (CD-5 §7.2). @param {IsoDate} date @returns {DayRecord|null} */
    latest: (date) => pending.get(date) ?? (inflight?.date === date ? inflight.record : null),
    /** Pending and in-flight records, for the effective list (CD-5 §6.1). @returns {DayRecord[]} */
    unsaved() {
      const list = [...pending.values()];
      if (inflight && !pending.has(inflight.date)) list.push(inflight.record);
      return list;
    },
    /** @param {IsoDate} date */
    has: (date) => pending.has(date) || inflight?.date === date,
  };
}
