// @ts-check
// Settings, weekday-table and tag service: load with seeding and repair, synchronous cached reads (CD-1 §11, CC-41).

import { WEEKDAYS } from '../core/dates.js';
import { SETTINGS_ID } from '../core/schema.js';
import { planSeedRepair } from '../core/settings-model.js';

/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Clock} Clock */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('../core/types.js').Tag} Tag */
/** @typedef {import('../core/types.js').WriteOp} WriteOp */
/** @typedef {import('../core/types.js').SettingsService} SettingsService */

// TODO(IT-06): updateWeekday, updateCategorySettings, addTag, addTags, updateTag, reorderTags, restoreDefaults on a
// private promise chain (CD-1 §11.1, §11.4), emitting data:changed after the cache is updated.
// TODO(IT-10): markExported (CD-1 §11.1, CC-41).

/**
 * Freezes objects and arrays recursively (cached values are immutable, CC-06, CC-30).
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/**
 * Applies put ops for `store` to `items`, replacing by key; the stores' own key paths (CC-10).
 * @template {object} T
 * @param {T[]} items
 * @param {WriteOp[]} ops
 * @param {'settings'|'weekdays'|'tags'} store
 * @param {(item: any) => string} keyOf
 * @returns {T[]}
 */
function applyPuts(items, ops, store, keyOf) {
  const byKey = new Map(items.map((it) => [keyOf(it), it]));
  for (const op of ops) {
    if (op.type === 'put' && op.store === store) byKey.set(keyOf(op.value), /** @type {T} */ (op.value));
  }
  return [...byKey.values()];
}

/** @param {Tag} a @param {Tag} b */
const tagOrder = (a, b) => a.order - b.order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * @param {{ db: Gateway, category: Category, clock: Clock, bus: import('../core/events.js').Emitter }} deps
 * @returns {SettingsService}
 */
export function createSettingsService({ db, category, clock }) {
  /** @type {{ settings: Settings, weekdays: WeekdayRow[], tags: Tag[] }|null} */
  let cache = null;

  const loaded = () => {
    if (!cache) throw new Error('settings service: load() has not completed');
    return cache;
  };

  /** Reads the three stores, writes any seed or repair in one transaction, then fills the caches (§11.2). */
  async function load() {
    const [settings, weekdays, tags] = /** @type {[Settings[], WeekdayRow[], Tag[]]} */ (await Promise.all([
      db.getAll('settings'), db.getAll('weekdays'), db.getAll('tags'),
    ]));
    const ops = planSeedRepair({ settings, weekdays, tags }, category, clock.now().toISOString());
    if (ops.length > 0) await db.write(ops);        // a rejection is fatal at boot (CC-29 rev 1)
    const nextSettings = applyPuts(settings, ops, 'settings', (s) => s.id).find((s) => s.id === SETTINGS_ID);
    const nextWeekdays = applyPuts(weekdays, ops, 'weekdays', (r) => r.weekday);
    const nextTags = applyPuts(tags, ops, 'tags', (t) => t.code);
    cache = deepFreeze({
      settings: /** @type {Settings} */ (nextSettings),
      weekdays: WEEKDAYS.map((code) => /** @type {WeekdayRow} */ (nextWeekdays.find((r) => r.weekday === code))),
      tags: [...nextTags].sort(tagOrder),
    });
  }

  return {
    load,
    reload: load,
    getSettings: () => loaded().settings,
    getCategorySettings: () => loaded().settings.category[category.id],
    getWeekdays: () => [...loaded().weekdays],
    getWeekday: (code) => /** @type {WeekdayRow} */ (loaded().weekdays.find((r) => r.weekday === code)),
    getTags: () => [...loaded().tags],
    getTag: (code) => loaded().tags.find((t) => t.code === code) ?? null,
  };
}
