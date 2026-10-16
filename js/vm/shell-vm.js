// @ts-check
// Shell view-model: pure route parsing and formatting, and the tab-bar state (CD-4 §5.3, §11).

import { isIsoDate } from '../core/dates.js';

/** @typedef {import('../core/types.js').IsoDate} IsoDate */
/** @typedef {{ page: string, date: IsoDate|null, redirect: boolean }} Route */
/** @typedef {{ activeTab: string, tabs: Array<{key: string, current: boolean}> }} ShellVM */

/** Every page key of CC-31; only those with a registered controller are routable. */
export const PAGE_KEYS = Object.freeze(['entry', 'history', 'baseline', 'charts', 'import', 'backup']);

/** Pages reached through one tab (CD-4 §15: the M2 Data tab covers import and backup). */
const TAB_OF = Object.freeze({ import: 'data', backup: 'data' });

/** @returns {Route} */
const followToday = (redirect) => ({ page: 'entry', date: null, redirect });

/**
 * Parses a location hash into a route (CD-4 §5.3). Unknown, malformed or future routes go to Entry
 * following today, with `redirect: true` so the router replaces the hash with the canonical one.
 * @param {string} hash  e.g. '#entry/2026-07-17'
 * @param {IsoDate} today
 * @param {string[]} knownPages  page keys with a registered controller
 * @returns {Route}
 */
export function parseRoute(hash, today, knownPages) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (raw === '' || raw === 'entry') return followToday(false);
  const [page, ...rest] = raw.split('/');
  if (page === 'entry') {
    const date = rest.join('/');
    if (rest.length !== 1 || !isIsoDate(date) || date > today) return followToday(true);
    if (date === today) return followToday(true);
    return { page: 'entry', date, redirect: false };
  }
  if (rest.length === 0 && PAGE_KEYS.includes(page) && knownPages.includes(page)) {
    return { page, date: null, redirect: false };
  }
  return followToday(true);
}

/**
 * The canonical hash for a route; today's date is never pinned (D4-04).
 * @param {{ page: string, date?: IsoDate|null }} route
 * @param {IsoDate} today
 * @returns {string}
 */
export function formatRoute(route, today) {
  if (route.page !== 'entry') return `#${route.page}`;
  return route.date && route.date !== today ? `#entry/${route.date}` : '#entry';
}

/**
 * Tab-bar state for a route.
 * @param {{ route: { page: string }, tabs: string[] }} input  tabs: the tab keys shown, in order
 * @returns {ShellVM}
 */
export function shellViewModel({ route, tabs }) {
  const activeTab = Object.hasOwn(TAB_OF, route.page) ? TAB_OF[route.page] : route.page;
  return { activeTab, tabs: tabs.map((key) => ({ key, current: key === activeTab })) };
}
