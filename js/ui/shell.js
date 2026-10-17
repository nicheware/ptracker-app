// @ts-check
// Shell: creates the page controllers, starts the router, marks the active tab, shows toasts and the update
// prompt and the save-error toast, flushes the save queue at the CC-29 flush points, emits boot:report and app:resume,
// reveals the app, and shows the fatal screen (CD-4 §5.1, §5.2, §5.6, §5.7).

import { createRouter } from './router.js';
import { createToaster } from './toast.js';
import { NOTICES, ACTIONS, messageFor } from './messages.js';
import { ERR } from '../core/errors.js';
import { paint } from './dom.js';
import { createEntryPage } from './pages/entry.js';
import { createHistoryPage } from './pages/history.js';
import { createBaselinePage } from './pages/baseline.js';
import { shellViewModel, resumeState } from '../vm/shell-vm.js';
import { EVENTS } from '../core/events.js';
import { todayIso } from '../core/dates.js';

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
 * @property {{ flush(): Promise<void>, retry(): Promise<void>, status(): import('../core/types.js').SaveStatus }} recordService
 * @property {import('../core/types.js').Category} category
 * @property {import('../core/types.js').SettingsService} settingsService
 * @property {import('../core/types.js').TransferService} transferService
 * @property {import('../core/types.js').StoragePersist} storagePersist
 * @property {import('../core/types.js').Prefs} prefs
 * @property {import('../core/types.js').BootReport} bootReport
 * @property {string} appName
 * @property {string} appVersion
 * @property {Document} [doc]
 * @property {Window} [win]
 */

/** @param {ShellDeps} deps */
export function startShell(deps) {
  const { doc = document, win = window, bus, clock, swClient, recordService, bootReport } = deps;
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
  bus.on(EVENTS.DB_VERSIONCHANGE, () => toaster.show({
    kind: 'warning',
    text: NOTICES.DB_VERSIONCHANGE,
    action: { label: ACTIONS.RELOAD, run: () => win.location.reload() },
    sticky: true,
    key: 'versionchange',
  }));
  bus.on(EVENTS.SAVE_STATUS, onSaveStatus);
  bus.on(EVENTS.BOOT_REPORT, (/** @type {import('../core/types.js').BootReport} */ report) => {
    if (report.quarantined > 0) {
      toaster.show({ kind: 'warning', text: NOTICES.QUARANTINED, action: null, sticky: false, key: 'quarantine' });
    }
  });

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
  bus.emit(EVENTS.BOOT_REPORT, bootReport);         // after init, so the Baseline page receives it (CD-4 §5.2)

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
  // Flush points (CC-29): hidden or leaving. Not awaited: the first write starts synchronously (CD-5 §9.3).
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') resume();
    else void recordService.flush();
  });
  win.addEventListener('pagehide', () => { void recordService.flush(); });
  win.addEventListener('pageshow', (event) => {
    if (/** @type {PageTransitionEvent} */ (event).persisted) resume();
  });

  /**
   * Save errors become one sticky toast (key 'save') with Retry → recordService.retry(); the next save that leaves
   * nothing in error dismisses it (CD-4 §5.7, CC-29 rev 1). SCHEMA_TOO_NEW offers Reload instead (CD-0 RR-4).
   * @param {{ status: string, error: import('../core/errors.js').AppError|null }} payload
   */
  function onSaveStatus({ status, error }) {
    if (status === 'error') showSaveError(error);
    else if ((status === 'saved' || status === 'idle') && recordService.status().status !== 'error') {
      toaster.dismiss('save');
    }
  }

  /** @param {import('../core/errors.js').AppError|null} error */
  function showSaveError(error) {
    const reload = error?.code === ERR.SCHEMA_TOO_NEW;
    toaster.show({
      kind: 'error',
      text: messageFor(error, 'save'),
      action: reload
        ? { label: ACTIONS.RELOAD, run: () => win.location.reload() }
        : { label: ACTIONS.RETRY, run: () => { void retrySave(); } },
      sticky: true,
      key: 'save',
    });
  }

  /** The toast is dismissed before its action runs, so a retry that fails again shows it again. */
  async function retrySave() {
    await recordService.retry();                      // never rejects
    const s = recordService.status();
    if (s.status === 'error') showSaveError(s.error);
  }

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

/**
 * Shows the static fatal screen with the wording for `error` and wires Reload. Never touches data (CD-4 §5.1).
 * @param {unknown} error
 * @param {{ doc?: Document, win?: Window }} [env]
 */
export function showFatal(error, { doc = document, win = window } = {}) {
  console.error('[ptracker:boot] fatal', error);
  const fatal = /** @type {HTMLElement} */ (doc.getElementById('fatal'));
  paint(fatal, { message: messageFor(error) });
  fatal.querySelector('[data-action="fatal.reload"]')?.addEventListener('click', () => win.location.reload());
  for (const id of ['boot', 'app', 'tabbar']) {
    const node = doc.getElementById(id);
    if (node) node.hidden = true;
  }
  fatal.hidden = false;
}
