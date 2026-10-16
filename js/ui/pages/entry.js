// @ts-check
// Entry page controller (CD-4 §8); IT-01 placeholder content with the real lifecycle (CD-4 §5.5).

import { paint } from '../dom.js';

/** @param {object} _deps */
export function createEntryPage(_deps) {
  /** @type {HTMLElement|null} */
  let root = null;
  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
    },
    /** @param {{ date?: string|null }} params */
    show({ date = null } = {}) {
      // TODO(IT-03): replace the placeholder with the entry view-model's date header.
      if (root) paint(root, { placeholder: { date: date ?? 'Following today' } });
    },
    async hide() {},
  };
}
