// @ts-check
// Shell: creates the page controllers, starts the router, marks the active tab and reveals the app (CD-4 §5.2).

import { createRouter } from './router.js';
import { createEntryPage } from './pages/entry.js';
import { createHistoryPage } from './pages/history.js';
import { createBaselinePage } from './pages/baseline.js';
import { shellViewModel } from '../vm/shell-vm.js';

// TODO(IT-02): toaster, sw:update-ready toast and app:resume emission.
// TODO(IT-03): day rollover on resume.
// TODO(IT-05): boot:report emission and the db:versionchange toast.
// TODO(IT-08): flush points (pagehide, visibilitychange → hidden) and the save-error toast.

/** M1 page factories (CC-31); M2 adds charts, import and backup. */
const PAGES = Object.freeze({
  entry: createEntryPage,
  history: createHistoryPage,
  baseline: createBaselinePage,
});

/**
 * @param {{ clock: import('../core/types.js').Clock, doc?: Document, win?: Window }} deps
 */
export function startShell(deps) {
  const { doc = document, win = window } = deps;
  const app = /** @type {HTMLElement} */ (doc.getElementById('app'));
  const tabbar = /** @type {HTMLElement} */ (doc.getElementById('tabbar'));
  const boot = /** @type {HTMLElement} */ (doc.getElementById('boot'));
  const tabLinks = [...tabbar.querySelectorAll('[data-tab]')];
  const tabKeys = tabLinks.map((a) => /** @type {HTMLElement} */ (a).dataset.tab ?? '');

  /** @type {Object<string, import('./router.js').PageEntry>} */
  const pages = {};
  for (const [key, create] of Object.entries(PAGES)) {
    const section = /** @type {HTMLElement} */ (doc.getElementById(`page-${key}`));
    const controller = create(deps);
    controller.init(section);
    pages[key] = { controller, section };
  }

  let revealed = false;
  const router = createRouter({
    pages,
    clock: deps.clock,
    win,
    onRoute(route) {
      const vm = shellViewModel({ route, tabs: tabKeys });
      for (const [i, link] of tabLinks.entries()) {
        if (vm.tabs[i].current) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      if (!revealed) {
        revealed = true;
        boot.hidden = true;
        app.hidden = false;
        tabbar.hidden = false;
      }
    },
  });
  router.start();
  return { router };
}
