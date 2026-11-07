// The AI4A11y toolkit, wired to chrome.storage for Headway's extension pages.
//
// Uses the toolkit's own Chrome port (platforms/chrome/ports.js chromeKV), so the
// profile is stored exactly where any other toolkit host on this browser expects
// it: chrome.storage.sync key `aa.mine.profile`. Bundled from the pinned checkout
// in vendor/ai4a11y-toolkit (run `python scripts/bootstrap_toolkit.py` first).

import { createToolkit } from '@ai4a11y/toolkit/index.js';
import { chromeKV, chromeClock } from '@ai4a11y/toolkit/platforms/chrome/ports.js';
import type { ProfileLibrarian } from './store.ts';

let ready: Promise<ProfileLibrarian> | null = null;

export function getLibrarian(): Promise<ProfileLibrarian> {
  if (!ready) {
    ready = (async () => {
      const { datastore, librarian } = createToolkit({ kv: chromeKV(), clock: chromeClock() });
      await datastore.runMigrations();
      return librarian;
    })();
  }
  return ready;
}
