// @ts-check
// Event bus: createEmitter() and the EVENTS names (CC-25, CD-5 §5).

export const EVENTS = Object.freeze({
  SAVE_STATUS: 'save:status', DATA_CHANGED: 'data:changed', EXPORT_DONE: 'export:done',
  UI_TOAST: 'ui:toast', SW_UPDATE_READY: 'sw:update-ready', APP_RESUME: 'app:resume',
  BOOT_REPORT: 'boot:report', DB_VERSIONCHANGE: 'db:versionchange',
});

/**
 * @typedef {Object} Emitter
 * @property {(type: string, handler: (payload: any) => void) => () => void} on   returns an idempotent unsubscribe
 * @property {(type: string, payload: any) => void} emit   synchronous delivery
 */

/**
 * @param {{ onError?: (err: unknown, type: string) => void }} [opts]  default: console.error
 * @returns {Emitter}
 */
export function createEmitter(opts = {}) {
  const onError = opts.onError ?? ((err, type) => console.error(`event ${type}:`, err));
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const handlers = new Map();

  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        handlers.get(type)?.delete(handler);
      };
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (err) {
          onError(err, type);
        }
      }
    },
  };
}
