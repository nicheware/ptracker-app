// @ts-check
// Composition root: builds the dependency graph and boots the app (CC-28, CC-29).

import { systemClock } from './infra/clock.js';
import { createSwClient } from './infra/sw-client.js';
import { openDb } from './infra/db.js';
import { createStoragePersist } from './infra/storage-persist.js';
import { createPrefs, safeLocalStorage } from './infra/prefs.js';
import { createEmitter, EVENTS } from './core/events.js';
import { createSettingsService } from './services/settings-service.js';
import { createRecordService } from './services/record-service.js';
import { startShell, showFatal } from './ui/shell.js';
import { assertRenderable } from './ui/dom.js';
import { getCategory, DEFAULT_CATEGORY_ID } from './categories/registry.js';
import { APP_NAME, VERSION } from './version.js';

async function main() {
  const bus = createEmitter();                                       // before openDb (CC-28 rev 1)
  const clock = systemClock;
  const prefs = createPrefs(safeLocalStorage());
  const storagePersist = createStoragePersist();
  const swClient = createSwClient({ bus });
  void swClient.register();                                          // step 1, not awaited
  let category, bootReport, settingsService, recordService;
  try {                                                              // fatal list: CC-29 rev 1
    category = getCategory(DEFAULT_CATEGORY_ID);                     // UNKNOWN_CATEGORY / CATEGORY_INVALID
    assertRenderable(category);                                      // CATEGORY_INVALID (CC-28 rev 1)
    const db = await openDb({ indexedDB: globalThis.indexedDB,       // step 2
      onVersionChange: () => bus.emit(EVENTS.DB_VERSIONCHANGE, {}) });
    bootReport = await db.boot({ category, clock, appVersion: VERSION });   // step 3
    settingsService = createSettingsService({ db, category, clock, bus });
    await settingsService.load();                                    // step 4; a failed seed write is fatal
    recordService = createRecordService({ db, category, clock, bus, settingsService });
    await recordService.load();                                      // step 5
    // TODO(IT-10): fileOut and transferService.
  } catch (e) {
    showFatal(e);
    return;
  }
  void storagePersist.persist();                                     // step 6, not awaited

  startShell({ bus, clock, swClient, recordService, category, settingsService, storagePersist, prefs, bootReport,
    appName: APP_NAME, appVersion: VERSION });                       // step 7
}

main();
