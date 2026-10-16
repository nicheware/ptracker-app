// @ts-check
// Database name, IndexedDB version, store layout and persisted-object schema versions (CC-10, CC-26, CD-1 §3).

export const DB_NAME = 'ptracker';

/** IndexedDB version; bumps only for store or index changes (CC-10). */
export const DB_VERSION = 1;

/** @type {Readonly<Record<'records'|'weekdays'|'tags'|'settings'|'quarantine', {name: string, keyPath: string, autoIncrement?: boolean}>>} */
export const STORES = Object.freeze({
  records: Object.freeze({ name: 'records', keyPath: 'date' }),
  weekdays: Object.freeze({ name: 'weekdays', keyPath: 'weekday' }),
  tags: Object.freeze({ name: 'tags', keyPath: 'code' }),
  settings: Object.freeze({ name: 'settings', keyPath: 'id' }),
  quarantine: Object.freeze({ name: 'quarantine', keyPath: 'id', autoIncrement: true }),
});

export const STORE_NAMES = Object.freeze(/** @type {const} */ (['records', 'weekdays', 'tags', 'settings', 'quarantine']));

/** The stores whose objects are migrated and shape-checked at boot (CD-1 §9). */
export const DATA_STORES = Object.freeze(/** @type {const} */ (['records', 'weekdays', 'tags', 'settings']));

/** Key of the single settings object (CC-14). */
export const SETTINGS_ID = 'app';

/** Schema version of each persisted object kind (CC-10, CC-26). */
export const SCHEMA = Object.freeze({ record: 1, weekday: 1, tag: 1, settings: 1, quarantine: 1, backup: 1 });

/** Maps a data store to its MigrationStep kind. */
export const KIND_OF_STORE = Object.freeze(/** @type {const} */ ({
  records: 'record', weekdays: 'weekday', tags: 'tag', settings: 'settings',
}));
