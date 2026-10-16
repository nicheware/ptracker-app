// @ts-check
// Composition root: builds the dependency graph and boots the app (CC-28, CC-29).

import { systemClock } from './infra/clock.js';
import { createSwClient } from './infra/sw-client.js';
import { createEmitter } from './core/events.js';
import { startShell } from './ui/shell.js';
import { APP_NAME, VERSION } from './version.js';

async function main() {
  const bus = createEmitter();                                       // before openDb (CC-28 rev 1)
  const clock = systemClock;
  // TODO(IT-09): prefs = createPrefs(safeLocalStorage()).
  // TODO(IT-05): storagePersist = createStoragePersist().
  const swClient = createSwClient({ bus });
  void swClient.register();                                          // step 1, not awaited
  // Fatal-path try block (CC-28 rev 1, CC-29 rev 1):
  // TODO(IT-04): category = getCategory(DEFAULT_CATEGORY_ID).
  // TODO(IT-06): assertRenderable(category).
  // TODO(IT-05): openDb({ indexedDB, onVersionChange }) (step 2), db.boot(...) (step 3), settingsService.load()
  //              (step 4); showFatal(e) on failure; storagePersist.persist() not awaited (step 6).
  // TODO(IT-07): recordService.load() (step 5).
  // TODO(IT-10): fileOut and transferService.

  // TODO(IT-08): stand-in until the record service exists; the update flow calls flush() then status().
  const recordService = {
    flush: async () => {},
    status: () => (/** @type {import('./core/types.js').SaveStatus} */ (
      { status: 'idle', date: null, error: null, pendingDates: [] })),
  };

  startShell({ bus, clock, swClient, recordService, appName: APP_NAME, appVersion: VERSION });   // step 7
}

main();
