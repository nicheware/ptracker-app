// @ts-check
// Composition root: builds the dependency graph and boots the app (CC-28, CC-29).

import { systemClock } from './infra/clock.js';
import { startShell } from './ui/shell.js';

async function main() {
  // TODO(IT-02): const bus = createEmitter(); swClient = createSwClient({ bus }); swClient.register() (step 1).
  const clock = systemClock;
  // TODO(IT-09): prefs = createPrefs(safeLocalStorage()).
  // TODO(IT-05): storagePersist = createStoragePersist().
  // Fatal-path try block (CC-28 rev 1, CC-29 rev 1):
  // TODO(IT-04): category = getCategory(DEFAULT_CATEGORY_ID).
  // TODO(IT-06): assertRenderable(category).
  // TODO(IT-05): openDb({ indexedDB, onVersionChange }) (step 2), db.boot(...) (step 3), settingsService.load()
  //              (step 4); showFatal(e) on failure; storagePersist.persist() not awaited (step 6).
  // TODO(IT-07): recordService.load() (step 5).
  // TODO(IT-10): fileOut and transferService.
  startShell({ clock });                                             // step 7
}

main();
