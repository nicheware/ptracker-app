// @ts-check
// Service-worker client: registration, update detection, update check on resume, applyUpdate (CD-7 §6).

import { AppError, ERR } from '../core/errors.js';
import { EVENTS } from '../core/events.js';

/**
 * @typedef {'unsupported'|'disabled'|'registering'|'active'|'update-ready'|'error'} SwState
 * @typedef {Object} SwClient
 * @property {() => Promise<void>} register        never rejects; failures logged as SW_REGISTER_FAILED
 * @property {() => Promise<void>} checkForUpdate  never rejects; no-op when not registered or offline
 * @property {() => void} applyUpdate              activates the waiting worker and reloads the page
 * @property {() => SwState} state                 for the settings page (optional display)
 * @property {() => Promise<string|null>} workerVersion   VERSION of the controlling worker, null if none
 */

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CACHE_PREFIX = 'ptracker-shell-';

/**
 * @param {{ bus: import('../core/events.js').Emitter, container?: any, location?: any, cacheStorage?: any,
 *           logger?: Pick<Console, 'warn'|'debug'>, reloadFallbackMs?: number }} deps
 * @returns {SwClient}
 */
export function createSwClient({
  bus,
  container = globalThis.navigator?.serviceWorker,
  location = globalThis.location,
  cacheStorage = globalThis.caches,
  logger = console,
  reloadFallbackMs = 3000,
}) {
  /** @type {SwState} */
  let state = 'registering';
  /** @type {any} */
  let reg = null;
  /** @type {any} */
  let readyWorker = null;
  /** @type {Promise<void>|null} */
  let inFlight = null;
  let updateRequested = false;
  let reloading = false;

  function isDevHost() {
    return DEV_HOSTS.has(String(location?.hostname ?? ''));
  }

  function devOptIn() {
    return new URLSearchParams(String(location?.search ?? '')).get('sw') === 'on';
  }

  /** Dev mode without ?sw=on: remove any registration for this scope and the shell caches (CD-7 §12). */
  async function unregisterForDev() {
    try {
      const existing = await container.getRegistration('./');
      if (existing) await existing.unregister();
      if (cacheStorage) {
        const keys = await cacheStorage.keys();
        await Promise.all(keys.filter((/** @type {string} */ k) => k.startsWith(CACHE_PREFIX))
          .map((/** @type {string} */ k) => cacheStorage.delete(k)));
      }
    } catch (e) {
      logger.debug('sw dev cleanup failed', e);
    }
  }

  /** @param {any} worker */
  function markReady(worker) {
    if (readyWorker === worker) return;           // emit once per waiting worker
    readyWorker = worker;
    state = 'update-ready';
    bus.emit(EVENTS.SW_UPDATE_READY, {});
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    location.reload();                            // the hash keeps page and date (CC-31)
  }

  function onControllerChange() {
    if (updateRequested) reload();                // ignore the first-install claim (CD-7 §4.4)
  }

  async function register() {
    if (!container) {
      state = 'unsupported';
      return;
    }
    if (isDevHost() && !devOptIn()) {
      state = 'disabled';
      await unregisterForDev();
      return;
    }
    state = 'registering';
    try {
      reg = await container.register('sw.js', { scope: './', updateViaCache: 'none' });
    } catch (cause) {
      state = 'error';
      logger.warn(new AppError(ERR.SW_REGISTER_FAILED, 'service worker registration failed', { cause }));
      return;                                     // the app keeps working online (CD-7 §14)
    }
    state = 'active';
    if (reg.waiting && container.controller) markReady(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && container.controller) markReady(w);
      });
    });
    container.addEventListener('controllerchange', onControllerChange);
    bus.on(EVENTS.APP_RESUME, () => { void checkForUpdate(); });
  }

  function checkForUpdate() {
    if (!reg) return Promise.resolve();
    inFlight ??= Promise.resolve()
      .then(() => reg.update())
      .catch((/** @type {unknown} */ e) => logger.debug('sw update check failed', e))   // offline: ignore
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  function applyUpdate() {
    const w = reg?.waiting;
    if (!w) {                                     // nothing waiting (already activated elsewhere)
      reload();
      return;
    }
    updateRequested = true;
    w.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, reloadFallbackMs);         // CD-7 §13 Q6: controllerchange can be late on iOS
  }

  /** @returns {Promise<string|null>} */
  function workerVersion() {
    const ctl = container?.controller;
    if (!ctl || typeof MessageChannel === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      /** @param {string|null} v */
      const done = (v) => {
        clearTimeout(timer);
        ch.port1.close();
        resolve(v);
      };
      const timer = setTimeout(() => done(null), 2000);
      ch.port1.onmessage = (ev) => done(ev.data?.type === 'VERSION' ? String(ev.data.version) : null);
      ctl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    });
  }

  return {
    register,
    checkForUpdate,
    applyUpdate,
    state: () => state,
    workerVersion,
  };
}
