// @ts-check
// Hash router: parses the hash, switches page sections and runs the controller lifecycle (CD-4 §5.4, CC-31).

import { todayIso } from '../core/dates.js';
import { parseRoute, formatRoute } from '../vm/shell-vm.js';

/** @typedef {import('../vm/shell-vm.js').Route} Route */
/** @typedef {import('../core/types.js').Clock} Clock */
/**
 * @typedef {Object} PageController
 * @property {(root: HTMLElement) => void} init
 * @property {(params: {date?: string|null}) => void} show
 * @property {() => Promise<void>} hide
 */
/** @typedef {{ controller: PageController, section: HTMLElement }} PageEntry */

/**
 * @param {{ pages: Object<string, PageEntry>, clock: Clock, onRoute?: (route: Route) => void, win?: Window }} deps
 * @returns {{ start(): void, go(route: {page: string, date?: string|null}, opts?: {replace?: boolean}): void,
 *             current(): Route|null }}
 */
export function createRouter({ pages, clock, onRoute = () => {}, win = window }) {
  /** @type {Route|null} */
  let currentRoute = null;
  /** @type {string|null} */
  let currentPage = null;
  /** @type {Object<string, number>} */
  const scrollOf = {};
  let chain = Promise.resolve();

  const today = () => todayIso(clock.now());

  /** Runs one routing step after the previous one has finished (fast taps cannot interleave). */
  function schedule() {
    chain = chain.then(handle).catch((e) => console.error('router:', e));
  }

  async function handle() {
    const route = parseRoute(win.location.hash, today(), Object.keys(pages));
    if (route.redirect) win.history.replaceState(null, '', formatRoute(route, today()));
    const next = pages[route.page];
    if (currentPage === route.page) {
      next.controller.show({ date: route.date });
      currentRoute = route;
      onRoute(route);
      return;
    }
    if (currentPage !== null) {
      const old = pages[currentPage];
      scrollOf[currentPage] = win.scrollY;
      await old.controller.hide();
      old.section.hidden = true;
    }
    next.section.hidden = false;
    next.controller.show({ date: route.date });
    currentPage = route.page;
    currentRoute = route;
    win.scrollTo(0, scrollOf[route.page] ?? 0);
    next.section.querySelector('h1')?.focus({ preventScroll: true });
    onRoute(route);
  }

  return {
    start() {
      win.addEventListener('hashchange', schedule);
      schedule();
    },
    go(route, { replace = false } = {}) {
      const hash = formatRoute(route, today());
      if (replace) {
        win.history.replaceState(null, '', hash);
        schedule();
      } else if (win.location.hash === hash) {
        schedule();
      } else {
        win.location.hash = hash;
      }
    },
    current() {
      return currentRoute;
    },
  };
}
