// @ts-check
// Shell: creates the page controllers, starts the router, marks the active tab, shows toasts and the update
// prompt, emits app:resume and reveals the app (CD-4 §5.2, §5.6, §5.7).

import { createRouter } from './router.js';
import { createToaster } from './toast.js';
import { NOTICES, ACTIONS } from './messages.js';
import { createEntryPage } from './pages/entry.js';
import { createHistoryPage } from './pages/history.js';
import { createBaselinePage } from './pages/baseline.js';
import { shellViewModel, resumeState } from '../vm/shell-vm.js';
import { EVENTS } from '../core/events.js';
import { todayIso } from '../core/dates.js';

// TODO(IT-05): boot:report emission and the db:versionchange toast.
// TODO(IT-08): flush points (pagehide, visibilitychange → hidden) and the save-error toast.

/** M1 page factories (CC-31); M2 adds charts, import and backup. */
const PAGES = Object.freeze({
  entry: createEntryPage,
  history: createHistoryPage,
  baseline: createBaselinePage,
});

/**
 * @typedef {Object} ShellDeps
 * @property {import('../core/types.js').Clock} clock
 * @property {import('../core/events.js').Emitter} bus
 * @property {import('../infra/sw-client.js').SwClient} swClient
 * @property {{ flush(): Promise<void>, status(): import('../core/types.js').SaveStatus }} recordService
 * @property {string} appName
 * @property {string} appVersion
 * @property {Document} [doc]
 * @property {Window} [win]
 */

/** @param {ShellDeps} deps */
export function startShell(deps) {
  const { doc = document, win = window, bus, clock, swClient, recordService } = deps;
  const app = /** @type {HTMLElement} */ (doc.getElementById('app'));
  const tabbar = /** @type {HTMLElement} */ (doc.getElementById('tabbar'));
  const boot = /** @type {HTMLElement} */ (doc.getElementById('boot'));
  const tabLinks = [...tabbar.querySelectorAll('[data-tab]')];
  const tabKeys = tabLinks.map((a) => /** @type {HTMLElement} */ (a).dataset.tab ?? '');

  const toaster = createToaster({
    politeRegion: /** @type {HTMLElement} */ (doc.getElementById('toasts')),
    alertRegion: /** @type {HTMLElement} */ (doc.getElementById('toasts-alert')),
  });
  bus.on(EVENTS.UI_TOAST, (toast) => toaster.show(toast));
  bus.on(EVENTS.SW_UPDATE_READY, showUpdateToast);

  /** @type {ReturnType<typeof createRouter>|null} */
  let router = null;
  /** Controllers navigate through the router, which is created after them (CD-4 §8.4). */
  const pageDeps = {
    ...deps,
    /** @type {(route: {page: string, date?: string|null}, opts?: {replace?: boolean}) => void} */
    navigate: (route, opts) => router?.go(route, opts),
  };

  /** @type {Object<string, import('./router.js').PageEntry>} */
  const pages = {};
  for (const [key, create] of Object.entries(PAGES)) {
    const section = /** @type {HTMLElement} */ (doc.getElementById(`page-${key}`));
    const controller = create(pageDeps);
    controller.init(section);
    pages[key] = { controller, section };
  }

  let revealed = false;
  router = createRouter({
    pages,
    clock,
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

  // Resume (CD-4 §5.6): visible again, or restored from the back/forward cache.
  let lastToday = todayIso(clock.now());
  function resume() {
    const state = resumeState(lastToday, clock.now());
    lastToday = state.today;
    bus.emit(EVENTS.APP_RESUME, state);           // Entry handles the day rollover (D4-09)
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') resume();
  });
  win.addEventListener('pageshow', (event) => {
    if (/** @type {PageTransitionEvent} */ (event).persisted) resume();
  });

  /** Sticky update prompt (CD-4 §5.7, CC-29 rev 1, CD-7 §7 U1). */
  function showUpdateToast() {
    toaster.show({
      kind: 'info',
      text: NOTICES.UPDATE_READY,
      action: { label: ACTIONS.RELOAD, run: () => { void reloadForUpdate(); } },
      sticky: true,
      key: 'update',
    });
  }

  /** CD-7 §7 U2: flush first; hold the update back while the last change is unsaved. */
  async function reloadForUpdate() {
    await recordService.flush();                      // never rejects (CC-25 rev 1)
    if (recordService.status().status === 'error') {
      showUpdateToast();                              // keep the update toast
      toaster.show({ kind: 'warning', text: NOTICES.UPDATE_HELD_BACK, action: null, sticky: false, key: 'update-held' });
      return;
    }
    swClient.applyUpdate();                           // the only caller (U3)
  }

  router.start();
  return { router, toaster };
}
