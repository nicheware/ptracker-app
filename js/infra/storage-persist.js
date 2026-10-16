// @ts-check
// Storage-persistence adapter over navigator.storage: persist() and persisted(), null when unsupported (CD-4 §3.1, CC-27).

/** @typedef {import('../core/types.js').StoragePersist} StoragePersist */

/**
 * @param {{ storage?: { persist?: () => Promise<boolean>, persisted?: () => Promise<boolean> } } | undefined} [nav]
 *        defaults to navigator
 * @returns {StoragePersist}
 */
export function createStoragePersist(nav = globalThis.navigator) {
  /** @param {'persist'|'persisted'} method @returns {Promise<boolean|null>} */
  async function call(method) {
    try {
      const storage = nav?.storage;
      const fn = storage?.[method];
      if (typeof fn !== 'function') return null;
      const result = await fn.call(storage);
      return typeof result === 'boolean' ? result : null;
    } catch {
      return null;
    }
  }
  return {
    persisted: () => call('persisted'),
    persist: () => call('persist'),
  };
}
