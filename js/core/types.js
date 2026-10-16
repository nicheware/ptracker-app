// @ts-check
// Shared JSDoc typedefs from CD-0 (CC-05); typedefs only. Later iterations add the rest.

/** @typedef {string} IsoDate   'YYYY-MM-DD', a local calendar date (no time, no zone) (CC-07) */
/** @typedef {'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun'} WeekdayCode  (CC-07) */
/** @typedef {string} Timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ' from Date#toISOString() (UTC) (CC-07) */
/** @typedef {{ now(): Date }} Clock  infra/clock.js (CC-27) */
/**
 * @typedef {Object} SaveStatus  record service save state (CC-25 rev 1)
 * @property {'idle'|'pending'|'saving'|'saved'|'error'} status
 * @property {IsoDate|null} date        statusOf(date): that date; status(): the most relevant date
 * @property {import('./errors.js').AppError|null} error
 * @property {IsoDate[]} pendingDates   dates waiting, ready or in flight
 */

export {};
