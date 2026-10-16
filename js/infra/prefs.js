// @ts-check
// UI preferences in localStorage: JSON values under the ptracker. prefix, never throwing (CD-4 §3.1, CC-36).

/** @typedef {import('../core/types.js').Prefs} Prefs */

const PREFIX = 'ptracker.';

/**
 * The browser's localStorage, or null when it is missing or access throws (private mode, blocked storage).
 * @returns {Storage|null}
 */
export function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Preferences over `store`; with null they live in memory only. get falls back on a missing, unreadable or
 * unparsable value; set never throws.
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} [store]
 * @returns {Prefs}
 */
export function createPrefs(store = safeLocalStorage()) {
  /** @type {Map<string, string>} */
  const memory = new Map();
  return {
    get(key, fallback) {
      try {
        const text = store ? store.getItem(PREFIX + key) : (memory.get(PREFIX + key) ?? null);
        return text === null ? fallback : JSON.parse(text);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const text = JSON.stringify(value);
        if (store) store.setItem(PREFIX + key, text);
        else memory.set(PREFIX + key, text);
      } catch {
        // A preference is rebuildable; losing one is harmless (CC-36).
      }
    },
  };
}
