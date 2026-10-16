// @ts-check
// Entry view-model: pure display state for the Entry page (CD-4 §8.3). IT-03 builds the date header part.

import { formatLongDate, formatShortDate, weekdayName, weekdayOf } from '../core/dates.js';

/** @typedef {import('../core/types.js').IsoDate} IsoDate */

/**
 * @typedef {Object} DateVM
 * @property {IsoDate} iso
 * @property {string} long           'Friday 17 July 2026' (FR-DATE-04)
 * @property {string} short          '17-Jul-26' (FR-DATE-04)
 * @property {string} weekday        full weekday name, 'Friday'
 * @property {boolean} isToday
 * @property {boolean} nextDisabled  no stepping past today (FR-DATE-03)
 * @property {boolean} showToday     the Today button, shown away from today
 * @property {IsoDate} max           the date picker's max (FR-DATE-03)
 */

/**
 * @typedef {Object} EntryVM
 * @property {DateVM} date
 */

/**
 * Date header state (CD-4 §8.3 `date`).
 * @param {IsoDate} iso
 * @param {IsoDate} today
 * @returns {DateVM}
 */
function dateViewModel(iso, today) {
  return {
    iso,
    long: formatLongDate(iso),
    short: formatShortDate(iso),
    weekday: weekdayName(weekdayOf(iso)),
    isToday: iso === today,
    nextDisabled: iso >= today,
    showToday: iso !== today,
    max: today,
  };
}

/**
 * The Entry page view-model (CD-4 §8.3).
 * @param {{ draft: { record: { date: IsoDate } }, ctx?: object|null, category?: object|null,
 *           tags?: object[], today: IsoDate, suggestions?: object|null }} input
 *   ctx: EntryContext from recordService.entryContext(draft) (CC-40)
 * @returns {EntryVM}
 */
export function entryViewModel({ draft, today }) {
  // TODO(IT-07): status, complete, metrics, badges, secondary, fields, errors, chips, combos, suggestion,
  // canDelete and announce from ctx, category, tags and suggestions (CD-4 §8.3).
  return { date: dateViewModel(draft.record.date, today) };
}

/**
 * What the Entry page does on `app:resume` (CD-4 §5.6, D4-09).
 * 'today': it follows today and the day changed, so it opens the new today;
 * 'refresh': it is pinned and the day changed, so it stays and repaints Next and the picker's max;
 * 'none': the day did not change.
 * @param {{ following: boolean, dayChanged: boolean }} state
 * @returns {'today'|'refresh'|'none'}
 */
export function resumeAction({ following, dayChanged }) {
  if (!dayChanged) return 'none';
  // TODO(IT-08): a follow-today page still completing yesterday's incomplete record stays on yesterday,
  // re-pins #entry/<yesterday> and shows the "It's now {long date}." toast with Go to today.
  return following ? 'today' : 'refresh';
}
