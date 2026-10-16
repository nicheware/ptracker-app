// @ts-check
// History page controller (CD-4 §9); IT-01 placeholder content with the real lifecycle (CD-4 §5.5).

import { paint } from '../dom.js';

/** @param {object} _deps */
export function createHistoryPage(_deps) {
  /** @type {HTMLElement|null} */
  let root = null;
  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
    },
    show() {
      // TODO(IT-09): replace the placeholder with the history view-model.
      if (root) paint(root, { placeholder: { text: 'Your saved days will be listed here.' } });
    },
    async hide() {},
  };
}
