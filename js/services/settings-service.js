// @ts-check
// Settings, weekday-table and tag service: load with seeding and repair, cached reads, serialised writes (CD-1 §11, CC-41).

import { WEEKDAYS } from '../core/dates.js';
import { SETTINGS_ID } from '../core/schema.js';
import { EVENTS } from '../core/events.js';
import { planSeedRepair, applyWeekdayPatch, applyCategorySettingsPatch, makeTag, makeTags, applyTagPatch, reorder,
  restoredDefaults } from '../core/settings-model.js';

/** @typedef {import('../core/types.js').Gateway} Gateway */
/** @typedef {import('../core/types.js').Category} Category */
/** @typedef {import('../core/types.js').Clock} Clock */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').WeekdayRow} WeekdayRow */
/** @typedef {import('../core/types.js').Tag} Tag */
/** @typedef {import('../core/types.js').WriteOp} WriteOp */
/** @typedef {import('../core/types.js').SettingsService} SettingsService */
/** @typedef {import('../core/types.js').ValidationIssue} ValidationIssue */
/** @typedef {import('../core/types.js').ValidationResult} ValidationResult */
/** @typedef {{ settings: Settings, weekdays: WeekdayRow[], tags: Tag[] }} Cache */
/** @typedef {'weekdays'|'tags'|'settings'} Scope */
/**
 * A planned write: the ops, the cache after them and the data:changed scopes; or the issues when invalid.
 * @typedef {{ ok: true, ops: WriteOp[], next: Cache, scopes: Scope[], extra?: object }
 *         | { ok: false, issues: ValidationIssue[] }} Plan
 */

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
export function createSettingsService({ db, category, clock, bus }) {
  /** @type {Cache|null} */
  let cache = null;
  /** Tail of the write chain (CD-1 §11.4); never rejects. @type {Promise<unknown>} */
  let tail = Promise.resolve();

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

  /**
   * Runs one write after the previous one has settled (CD-1 §11.4). The plan is computed from the cache as left by
   * the previous write; a rejected db.write leaves the cache untouched and rejects with its AppError.
   * @param {(current: Cache) => Plan} plan
   * @returns {Promise<ValidationResult & { extra?: object }>}
   */
  function step(plan) {
    const run = tail.then(async () => {
      const res = plan(loaded());
      if (!res.ok) return { ok: false, issues: res.issues };
      if (res.ops.length > 0) await db.write(res.ops);
      cache = deepFreeze({ ...res.next, tags: [...res.next.tags].sort(tagOrder) });
      for (const scope of res.scopes) bus.emit(EVENTS.DATA_CHANGED, { scope, dates: null });
      return { ok: true, issues: [], ...(res.extra ? { extra: res.extra } : {}) };
    });
    tail = run.catch(() => {});
    return run;
  }

  /** @param {Tag[]} tags @param {Tag[]} changed */
  const replaceTags = (tags, changed) => tags.map((t) => changed.find((c) => c.code === t.code) ?? t);

  /** @type {SettingsService['updateWeekday']} */
  function updateWeekday(code, patch) {
    return step((c) => {
      const row = c.weekdays.find((r) => r.weekday === code);
      if (!row) throw new Error(`updateWeekday: unknown weekday ${code}`);
      const res = applyWeekdayPatch(row, patch, category);
      if (!res.ok) return res;
      return { ok: true, ops: [{ type: 'put', store: 'weekdays', value: res.row }], scopes: ['weekdays'],
        next: { ...c, weekdays: c.weekdays.map((r) => (r.weekday === code ? res.row : r)) } };
    });
  }

  /** @type {SettingsService['updateCategorySettings']} */
  function updateCategorySettings(patch) {
    return step((c) => {
      const res = applyCategorySettingsPatch(c.settings, patch, category);
      if (!res.ok) return res;
      return { ok: true, ops: [{ type: 'put', store: 'settings', value: res.settings }], scopes: ['settings'],
        next: { ...c, settings: res.settings } };
    });
  }

  /** @type {SettingsService['addTag']} */
  function addTag(tag) {
    return step((c) => {
      const res = makeTag(tag, c.tags);
      if (!res.ok) return res;
      return { ok: true, ops: [{ type: 'put', store: 'tags', value: res.tag }], scopes: ['tags'],
        next: { ...c, tags: [...c.tags, res.tag] } };
    });
  }

  /** @type {SettingsService['addTags']} */
  async function addTags(defs) {
    const r = await step((c) => {
      const res = makeTags(defs, c.tags);
      if (!res.ok) return res;
      return { ok: true, ops: res.tags.map((t) => ({ type: 'put', store: 'tags', value: t })),
        scopes: res.tags.length > 0 ? ['tags'] : [], next: { ...c, tags: [...c.tags, ...res.tags] },
        extra: { added: res.added } };
    });
    const added = /** @type {{ added?: string[] }} */ (r.extra ?? {}).added ?? [];
    return { ok: r.ok, issues: r.issues, added };
  }

  /** @type {SettingsService['updateTag']} */
  function updateTag(code, patch) {
    return step((c) => {
      const tag = c.tags.find((t) => t.code === code);
      if (!tag) throw new Error(`updateTag: unknown tag ${code}`);
      const res = applyTagPatch(tag, patch);
      if (!res.ok) return res;
      return { ok: true, ops: [{ type: 'put', store: 'tags', value: res.tag }], scopes: ['tags'],
        next: { ...c, tags: replaceTags(c.tags, [res.tag]) } };
    });
  }

  /** @type {SettingsService['reorderTags']} */
  async function reorderTags(codes) {
    await step((c) => {
      const changed = reorder(c.tags, codes).filter((t) => c.tags.find((o) => o.code === t.code)?.order !== t.order);
      return { ok: true, ops: changed.map((t) => ({ type: 'put', store: 'tags', value: t })),
        scopes: changed.length > 0 ? ['tags'] : [], next: { ...c, tags: replaceTags(c.tags, changed) } };
    });
  }

  /** FR-BAS-08: weekday table and category settings in one write; tags, export stamps and records untouched (Q5). */
  async function restoreDefaults() {
    await step((c) => {
      const res = restoredDefaults(c, category);
      /** @type {WriteOp[]} */
      const ops = [
        ...res.weekdays.map((r) => /** @type {WriteOp} */ ({ type: 'put', store: 'weekdays', value: r })),
        { type: 'put', store: 'settings', value: res.settings },
      ];
      return { ok: true, ops, scopes: ['weekdays', 'settings'], next: { ...c, ...res } };
    });
  }

  /**
   * The only export-tracking write (CC-41): lastExportAt (csv) or lastBackupAt (backup), plus
   * lastExportRecordUpdatedAt. Called by the transfer service after 'shared' or 'downloaded' (CD-6 §6.4).
   * @type {SettingsService['markExported']}
   */
  async function markExported(kind, at, maxRecordUpdatedAt) {
    await step((c) => {
      const settings = { ...c.settings, [kind === 'backup' ? 'lastBackupAt' : 'lastExportAt']: at,
        lastExportRecordUpdatedAt: maxRecordUpdatedAt };
      return { ok: true, ops: [{ type: 'put', store: 'settings', value: settings }], scopes: ['settings'],
        next: { ...c, settings } };
    });
  }

  return {
    load,
    reload: load,
    updateWeekday,
    updateCategorySettings,
    addTag,
    addTags,
    updateTag,
    reorderTags,
    restoreDefaults,
    markExported,
    getSettings: () => loaded().settings,
    getCategorySettings: () => loaded().settings.category[category.id],
    getWeekdays: () => [...loaded().weekdays],
    getWeekday: (code) => /** @type {WeekdayRow} */ (loaded().weekdays.find((r) => r.weekday === code)),
    getTags: () => [...loaded().tags],
    getTag: (code) => loaded().tags.find((t) => t.code === code) ?? null,
  };
}
