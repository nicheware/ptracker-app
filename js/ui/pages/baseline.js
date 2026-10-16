// @ts-check
// Baseline & settings page controller (CD-4 §10); IT-01 placeholder content with the real lifecycle (CD-4 §5.5).

import { paint } from '../dom.js';

/** @param {object} _deps */
export function createBaselinePage(_deps) {
  /** @type {HTMLElement|null} */
  let root = null;
  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
    },
    show() {
      // TODO(IT-04): replace the placeholder with the baseline view-model.
      if (root) paint(root, { placeholder: { text: 'Weekday baselines and settings will be shown here.' } });
    },
    async hide() {},
  };
}
