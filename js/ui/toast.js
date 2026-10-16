// @ts-check
// Toaster: shows CC-25 Toasts in the polite or alert live region (CD-4 §5.7).

import { el } from './dom.js';

/**
 * @typedef {Object} Toast
 * @property {'info'|'success'|'warning'|'error'} kind
 * @property {string} text                 user wording
 * @property {{label: string, run: () => void}|null} action   e.g. Retry, Reload
 * @property {boolean} sticky              stays until acted on or replaced
 * @property {string|null} key             a new toast with the same key replaces the old one
 */

const SHORT_MS = 2500;
const WITH_ACTION_MS = 4000;

/**
 * @param {{ politeRegion: HTMLElement, alertRegion: HTMLElement,
 *           setTimeout?: (fn: () => void, ms: number) => any, clearTimeout?: (id: any) => void }} deps
 * @returns {{ show(toast: Toast): void, dismiss(key: string): void }}
 */
export function createToaster({
  politeRegion,
  alertRegion,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
}) {
  /** @type {Map<string, {node: HTMLElement, timer: any}>} key → visible toast */
  const visible = new Map();
  /** Key of the one visible non-sticky toast, if any. */
  let transientKey = /** @type {string|null} */ (null);
  let seq = 0;

  /** @param {string} key */
  function remove(key) {
    const entry = visible.get(key);
    if (!entry) return;
    if (entry.timer != null) clearTimer(entry.timer);
    entry.node.remove();
    visible.delete(key);
    if (transientKey === key) transientKey = null;
  }

  /** @param {Toast} toast */
  function show(toast) {
    const key = toast.key ?? `toast-${++seq}`;
    remove(key);
    if (!toast.sticky && transientKey) remove(transientKey);   // at most one non-sticky toast

    const action = toast.action;
    const button = action
      ? el('button', {
        class: 'toast-action',
        attrs: { type: 'button' },
        text: action.label,
        on: {
          click: () => {
            remove(key);
            action.run();
          },
        },
      })
      : null;
    const node = el('div', { class: `toast toast-${toast.kind}`, dataset: { key } },
      el('span', { class: 'toast-text', text: toast.text }), button);

    const region = toast.kind === 'error' ? alertRegion : politeRegion;
    region.append(node);

    let timer = null;
    if (!toast.sticky) {
      timer = setTimer(() => remove(key), action ? WITH_ACTION_MS : SHORT_MS);
      transientKey = key;
    }
    visible.set(key, { node, timer });
  }

  return {
    show,
    dismiss: remove,
  };
}
