// @ts-check
// System clock adapter: the only place that reads the real time (CC-07, CC-27).

/** @type {import('../core/types.js').Clock} */
export const systemClock = { now: () => new Date() };
