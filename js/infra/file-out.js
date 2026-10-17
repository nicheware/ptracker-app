// @ts-check
// File-out adapter: Web Share with a File when the browser can share files, else an anchor download (CD-6 §6.3, CC-27).

import { AppError, ERR } from '../core/errors.js';

/** @typedef {import('../core/types.js').FileOut} FileOut */

/** The object URL of an anchor download is revoked after this delay (the download has started by then). */
const REVOKE_MS = 10_000;

/**
 * @param {{ navigator?: any, document?: Document, later?: (fn: () => void, ms: number) => void }} [deps]
 *        later: the revoke timer (tests pass one that does not keep Node alive)
 * @returns {FileOut}
 */
export function createFileOut({ navigator: nav = globalThis.navigator, document: doc = globalThis.document,
  later = (fn, ms) => { setTimeout(fn, ms); } } = {}) {
  return {
    save({ name, type, text }) {
      const file = new File([text], name, { type });
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        // Called synchronously, inside the tap: no await before this line (CC-27 rev 1). Only `files` is passed:
        // a title or text makes some iOS targets save an extra text file.
        return nav.share({ files: [file] }).then(
          () => /** @type {'shared'} */ ('shared'),
          (/** @type {any} */ err) => {
            if (err && err.name === 'AbortError') return /** @type {'cancelled'} */ ('cancelled');
            throw new AppError(ERR.SHARE_FAILED, String(err && err.message), { cause: err });
          });
      }
      try {
        const url = URL.createObjectURL(file);
        const a = /** @type {Document} */ (doc).createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        /** @type {Document} */ (doc).body.append(a);
        a.click();
        a.remove();
        later(() => URL.revokeObjectURL(url), REVOKE_MS);
        return Promise.resolve(/** @type {'downloaded'} */ ('downloaded'));
      } catch (err) {
        return Promise.reject(new AppError(ERR.SHARE_FAILED, 'download fallback failed', { cause: err }));
      }
    },
  };
}
