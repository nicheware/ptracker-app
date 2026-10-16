// @ts-check
// Composition root: builds the dependency graph and boots the app (CC-28, CC-29).

import { systemClock } from './infra/clock.js';
import { createSwClient } from './infra/sw-client.js';
import { createEmitter } from './core/events.js';
import { startShell } from './ui/shell.js';
import { getCategory, DEFAULT_CATEGORY_ID } from './categories/registry.js';
import { seedSettings, seedTags, seedWeekdayRows } from './core/settings-model.js';
import { APP_NAME, VERSION } from './version.js';

async function main() {
  const bus = createEmitter();                                       // before openDb (CC-28 rev 1)
  const clock = systemClock;
  // TODO(IT-09): prefs = createPrefs(safeLocalStorage()).
  // TODO(IT-05): storagePersist = createStoragePersist().
  const swClient = createSwClient({ bus });
  void swClient.register();                                          // step 1, not awaited
  // Fatal-path try block (CC-28 rev 1, CC-29 rev 1):
  const category = getCategory(DEFAULT_CATEGORY_ID);                 // runs assertCategory (CD-3 §3)
  // TODO(IT-06): assertRenderable(category).
  // TODO(IT-05): openDb({ indexedDB, onVersionChange }) (step 2), db.boot(...) (step 3), settingsService.load()
  //              (step 4); showFatal(e) on failure; storagePersist.persist() not awaited (step 6).
  // TODO(IT-07): recordService.load() (step 5).
  // TODO(IT-10): fileOut and transferService.

  // TODO(IT-05): read-only stand-in with the CC-41 getter names, built from the category's seeds, until
  // settingsService.load() reads the stores.
  const settingsService = createSeedSettings(category, clock.now().toISOString());

  // TODO(IT-08): stand-in until the record service exists; the update flow calls flush() then status().
  const recordService = {
    flush: async () => {},
    status: () => (/** @type {import('./core/types.js').SaveStatus} */ (
      { status: 'idle', date: null, error: null, pendingDates: [] })),
  };

  startShell({ bus, clock, swClient, recordService, category, settingsService,
    appName: APP_NAME, appVersion: VERSION });                       // step 7
}

/**
 * TODO(IT-05): remove with the stand-in above.
 * @param {import('./core/types.js').Category} category
 * @param {string} now
 * @returns {import('./core/types.js').SettingsService}
 */
function createSeedSettings(category, now) {
  const settings = Object.freeze(seedSettings(category, now));
  const weekdays = Object.freeze(seedWeekdayRows(category).map((r) => Object.freeze(r)));
  const tags = Object.freeze(seedTags(category).map((t) => Object.freeze(t)));
  return {
    getSettings: () => settings,
    getCategorySettings: () => settings.category[category.id],
    getWeekdays: () => [...weekdays],
    getWeekday: (code) => /** @type {import('./core/types.js').WeekdayRow} */ (weekdays.find((r) => r.weekday === code)),
    getTags: () => [...tags],
    getTag: (code) => tags.find((t) => t.code === code) ?? null,
  };
}

main();
