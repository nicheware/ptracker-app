// @ts-check
// IndexedDB gateway: open and upgrade, atomic batch writes, reads, the boot integrity pass and boot cache (CD-1 §6, §7, §9.3, §12.3, CC-39).

import { DB_NAME, DB_VERSION, STORES, STORE_NAMES, DATA_STORES } from '../core/schema.js';
import { AppError, ERR, isAppError } from '../core/errors.js';
import { checkPlainData, planIntegrity } from '../core/migrations.js';

/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').StoreName} StoreName */
/** @typedef {import('../core/types.js').WriteOp} WriteOp */
/** @typedef {import('../core/types.js').WriteResult} WriteResult */
/** @typedef {import('../core/types.js').BootReport} BootReport */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Clock} Clock */

// putIfAbsent, readSnapshot and replaceAll are M2 (CD-1 §14); they are not built in M1.

const BLOCKED_TIMEOUT_MS = 3000;
const OPEN_ATTEMPTS = 2;

/**
 * Store upgrades keyed by the version they produce. Each step only creates or deletes stores and indexes; object
 * shapes are migrated by the boot pass (CD-1 §6.2, §8.1).
 * @type {Readonly<Record<number, (db: IDBDatabase, tx: IDBTransaction|null) => void>>}
 */
export const UPGRADES = Object.freeze({
  1: (db) => {
    for (const name of STORE_NAMES) {
      const s = STORES[name];
      db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: !!s.autoIncrement });
    }
  },
});

/**
 * Maps an exception to an AppError (CD-1 §6.3); the original is kept as `cause`.
 * @param {unknown} e
 * @param {string} fallback  usually ERR.TX_FAILED
 * @returns {AppError}
 */
export function toAppError(e, fallback) {
  if (isAppError(e)) return e;
  const name = /** @type {any} */ (e)?.name;
  const message = /** @type {any} */ (e)?.message ?? String(e);
  if (name === 'QuotaExceededError') return new AppError(ERR.QUOTA_EXCEEDED, message, { cause: e });
  if (name === 'VersionError') return new AppError(ERR.SCHEMA_TOO_NEW, message, { cause: e });
  return new AppError(fallback, e == null ? fallback : message, { cause: e });
}

/** @param {unknown} e  true when the connection is gone and a reopen may help (CD-1 §6.3) */
const isConnectionLost = (e) => {
  const name = /** @type {any} */ (e)?.name;
  return name === 'InvalidStateError' || name === 'UnknownError';
};

/** @returns {number} */
const now = () => globalThis.performance?.now?.() ?? 0;

/**
 * Opens one connection, with the open timeout and one retry (CD-1 §6.2).
 * @param {any} indexedDB
 * @param {number} openTimeoutMs
 * @returns {Promise<IDBDatabase>}
 */
function openConnection(indexedDB, openTimeoutMs) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let settled = false;
    /** @param {() => void} fn */
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    function start() {
      /** @type {IDBOpenDBRequest} */
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        const code = /** @type {any} */ (e)?.name === 'SecurityError' ? ERR.DB_UNAVAILABLE : ERR.DB_OPEN_FAILED;
        settle(() => reject(new AppError(code, 'indexedDB.open threw', { cause: e })));
        return;
      }
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let blockedTimer;
      let heard = false;
      const openTimer = setTimeout(() => {
        if (heard || settled) return;
        attempt++;
        if (attempt < OPEN_ATTEMPTS) start();       // WebKit: the first open after install or resume may never fire
        else settle(() => reject(new AppError(ERR.DB_OPEN_FAILED, 'open timed out')));
      }, openTimeoutMs);
      const stopTimers = () => {
        heard = true;
        clearTimeout(openTimer);
        clearTimeout(blockedTimer);
      };

      req.onupgradeneeded = (e) => {
        heard = true;
        clearTimeout(openTimer);
        const db = req.result;
        for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) UPGRADES[v](db, req.transaction);
      };
      req.onblocked = () => {
        heard = true;
        clearTimeout(openTimer);
        blockedTimer = setTimeout(() => settle(() => reject(new AppError(ERR.DB_BLOCKED, 'open blocked'))), BLOCKED_TIMEOUT_MS);
      };
      req.onsuccess = () => {
        stopTimers();
        const conn = req.result;
        if (settled) conn.close();                  // a late answer to an abandoned attempt
        else settle(() => resolve(conn));
      };
      req.onerror = (e) => {
        stopTimers();
        e.preventDefault?.();
        const err = req.error;
        const code = err?.name === 'VersionError' ? ERR.SCHEMA_TOO_NEW : ERR.DB_OPEN_FAILED;
        settle(() => reject(new AppError(code, err?.message ?? 'open failed', { cause: err })));
      };
    }
    start();
  });
}

/**
 * Opens (and if needed creates or upgrades) the database.
 * @param {{ indexedDB: any, openTimeoutMs?: number, onVersionChange?: () => void }} deps
 * @returns {Promise<Gateway>}  rejects with AppError DB_UNAVAILABLE | DB_OPEN_FAILED | DB_BLOCKED | SCHEMA_TOO_NEW
 */
export async function openDb({ indexedDB, openTimeoutMs = 4000, onVersionChange = () => {} }) {
  if (!indexedDB) throw new AppError(ERR.DB_UNAVAILABLE, 'indexedDB is not available');
  const t0 = now();
  /** @type {IDBDatabase} */
  let conn = await openConnection(indexedDB, openTimeoutMs);
  let closed = false;
  /** @type {Promise<void>|null} */
  let reopening = null;
  /** First getAll per data store after boot (CD-1 §12.3). @type {Map<StoreName, object[]>} */
  const bootCache = new Map();
  install(conn);
  console.info('[ptracker:boot] openDb', Math.round(now() - t0), 'ms');

  /** @param {IDBDatabase} c */
  function install(c) {
    c.onversionchange = () => {
      c.close();
      if (c === conn) closed = true;
      try {
        onVersionChange();
      } catch (e) {
        console.error('onVersionChange failed:', e);
      }
    };
    c.onclose = () => {
      if (c === conn) closed = true;
    };
  }

  /** @returns {Promise<void>} */
  function reconnect() {
    reopening ??= openConnection(indexedDB, openTimeoutMs).then((c) => {
      conn = c;
      closed = false;
      install(c);
    }).finally(() => {
      reopening = null;
    });
    return reopening;
  }

  /**
   * One transaction; settles on complete or abort. `body` is synchronous and issues requests whose callbacks fill
   * `out`; it may call `abortWith(err)` from a callback. No await happens inside (T6).
   * @template T
   * @param {readonly StoreName[]} stores
   * @param {IDBTransactionMode} mode
   * @param {(tx: IDBTransaction, out: T, abortWith: (e: unknown) => void) => void} body
   * @param {T} out
   * @returns {Promise<T>}  rejects with the raw exception (mapped by the caller)
   */
  function runTx(stores, mode, body, out) {
    return new Promise((resolve, reject) => {
      /** @type {IDBTransaction} */
      let tx;
      /** @type {unknown} */
      let bodyError = null;
      try {
        tx = mode === 'readwrite'
          ? conn.transaction([...stores], mode, { durability: 'strict' })
          : conn.transaction([...stores], mode);
      } catch (e) {
        reject(e);
        return;
      }
      /** @param {unknown} e */
      const abortWith = (e) => {
        bodyError ??= e;
        try {
          tx.abort();
        } catch { /* already finished */ }
      };
      tx.oncomplete = () => resolve(out);
      tx.onabort = () => reject(bodyError ?? tx.error);
      try {
        body(tx, out, abortWith);
      } catch (e) {
        abortWith(e);
      }
    });
  }

  /**
   * Runs an operation, reconnecting and retrying once if the connection was lost (CD-1 §6.3). When the
   * connection is open, the transaction is created synchronously inside this call (CC-39).
   * @template T
   * @param {readonly StoreName[]} stores
   * @param {IDBTransactionMode} mode
   * @param {(tx: IDBTransaction, out: T, abortWith: (e: unknown) => void) => void} body
   * @param {() => T} makeOut
   * @returns {Promise<T>}
   */
  function run(stores, mode, body, makeOut) {
    /** @param {boolean} retried @returns {Promise<T>} */
    const attempt = (retried) => runTx(stores, mode, body, makeOut()).catch((e) => {
      if (!retried && isConnectionLost(e)) {
        closed = true;
        return reconnect().then(() => attempt(true));
      }
      throw toAppError(e, ERR.TX_FAILED);
    });
    if (closed) return reconnect().then(() => attempt(true));
    return attempt(false);
  }

  /**
   * @template T
   * @param {StoreName} store
   * @param {(s: IDBObjectStore) => IDBRequest} request
   * @param {(result: any) => T} map
   * @returns {Promise<T>}
   */
  function read(store, request, map) {
    return run([store], 'readonly', (tx, out) => {
      const r = request(tx.objectStore(store));
      r.onsuccess = () => { out.value = map(r.result); };
    }, () => /** @type {{value: any}} */ ({ value: undefined })).then((out) => out.value);
  }

  /** @type {Gateway} */
  const gateway = {
    getAll(store) {
      const cached = bootCache.get(store);
      if (cached) {
        bootCache.delete(store);
        return Promise.resolve(cached);
      }
      return read(store, (s) => s.getAll(), (r) => r);
    },

    get(store, key) {
      return read(store, (s) => s.get(key), (r) => r ?? null);
    },

    count(store) {
      return read(store, (s) => s.count(), (r) => r);
    },

    write(ops) {                                    // not async: the transaction starts inside this call
      if (ops.length === 0) return Promise.resolve({ written: 0, skipped: [], deleted: 0 });
      for (const op of ops) {
        if (op.type !== 'put' && op.type !== 'add' && op.type !== 'delete' && op.type !== 'clear') {
          return Promise.reject(new Error(`write: unsupported op ${op.type}`));
        }
        if (!STORE_NAMES.includes(op.store)) return Promise.reject(new Error(`write: unknown store ${op.store}`));
        if (op.type === 'put' || op.type === 'add') {
          const problem = checkPlainData(op.value);
          if (problem) return Promise.reject(new Error(`write: ${problem}`));
          const v = /** @type {any} */ (op.value).schemaVersion;
          if (!Number.isInteger(v) || v < 1) return Promise.reject(new Error('write: schemaVersion is not a positive integer'));
        }
      }
      const stores = [...new Set(ops.map((op) => op.store))];
      bootCache.clear();
      return run(stores, 'readwrite', (tx, out) => {
        for (const op of ops) {
          const s = tx.objectStore(op.store);
          if (op.type === 'put') {
            s.put(op.value);
            out.written++;
          } else if (op.type === 'add') {
            s.add(op.value);
            out.written++;
          } else if (op.type === 'delete') {
            s.delete(op.key);
            out.deleted++;
          } else if (op.type === 'clear') {
            s.clear();
          }
        }
      }, () => /** @type {WriteResult} */ ({ written: 0, skipped: [], deleted: 0 }));
    },

    boot({ category, clock, appVersion }) {
      const t0 = now();
      bootCache.clear();
      /** @type {{plan: import('../core/migrations.js').IntegrityPlan|null, quarantineTotal: number}} */
      const makeOut = () => ({ plan: null, quarantineTotal: 0 });
      return run([...DATA_STORES, 'quarantine'], 'readwrite', (tx, out, abortWith) => {
        /** @type {any} */
        const raw = { records: [], weekdays: [], tags: [], settings: [], keys: { records: [], weekdays: [], tags: [], settings: [] } };
        let pending = DATA_STORES.length * 2;
        const done = () => {
          if (--pending > 0) return;
          try {
            const r = planIntegrity(raw, { category, now: clock.now().toISOString(), appVersion });
            if (!r.ok) {
              abortWith(r.error);                    // nothing written
              return;
            }
            const { plan } = r;
            for (const p of plan.puts) tx.objectStore(p.store).put(p.value);
            for (const d of plan.deletes) tx.objectStore(d.store).delete(d.key);
            for (const q of plan.quarantine) tx.objectStore('quarantine').add(q);
            const c = tx.objectStore('quarantine').count();
            c.onsuccess = () => { out.quarantineTotal = c.result; };
            out.plan = plan;
          } catch (e) {
            abortWith(e);
          }
        };
        for (const store of DATA_STORES) {
          const s = tx.objectStore(store);
          const values = s.getAll();
          values.onsuccess = () => { raw[store] = values.result; done(); };
          const keys = s.getAllKeys();
          keys.onsuccess = () => { raw.keys[store] = keys.result; done(); };
        }
      }, makeOut).then(({ plan, quarantineTotal }) => {
        const p = /** @type {import('../core/migrations.js').IntegrityPlan} */ (plan);
        for (const line of p.log) {
          if (line.startsWith('quarantined')) console.warn(`[ptracker:integrity] ${line}`);
          else console.info(`[ptracker:integrity] ${line}`);
        }
        for (const store of DATA_STORES) bootCache.set(store, p.result[store]);
        console.info('[ptracker:boot] integrity pass', p.result.records.length, 'records', Math.round(now() - t0), 'ms');
        return { ...p.counts, quarantineTotal };
      });
    },

    close() {
      bootCache.clear();
      closed = true;
      conn.close();
    },
  };
  return gateway;
}
