// @ts-check
// Baseline & settings page controller (CD-4 §10); placeholder content plus the About panel's version.

import { paint } from '../dom.js';

/** @param {{ appName: string, appVersion: string }} deps */
export function createBaselinePage(deps) {
  /** @type {HTMLElement|null} */
  let root = null;
  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
    },
    show() {
      // TODO(IT-04): replace the placeholder with the baseline view-model (CD-4 §10.3), which also builds `about`.
      if (root) {
        paint(root, {
          placeholder: { text: 'Weekday baselines and settings will be shown here.' },
          about: { name: deps.appName, version: deps.appVersion },
        });
      }
    },
    async hide() {},
  };
}
