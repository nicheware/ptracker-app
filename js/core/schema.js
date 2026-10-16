// @ts-check
// Database name, IndexedDB version, store names and persisted-object schema versions (CC-10, CC-26).

export const DB_NAME = 'ptracker';

/** IndexedDB version; bumps only for store or index changes (CC-10). */
export const DB_VERSION = 1;

export const STORES = Object.freeze({
  records: 'records',
  weekdays: 'weekdays',
  tags: 'tags',
  settings: 'settings',
  quarantine: 'quarantine',
});

/** Schema version of each persisted object kind (CC-10, CC-26). */
export const SCHEMA = Object.freeze({ record: 1, weekday: 1, tag: 1, settings: 1, quarantine: 1, backup: 1 });
