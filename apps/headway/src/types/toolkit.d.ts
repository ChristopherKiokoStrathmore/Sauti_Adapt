// Types for the parts of the AI4A11y toolkit Headway uses. The toolkit is plain
// JavaScript bundled from vendor/ai4a11y-toolkit (build.mjs aliases
// '@ai4a11y/toolkit' to it); tests import the same files by relative path.

interface AA_KV {
  get(area: string, key: string): Promise<unknown>;
  set(area: string, key: string, value: unknown): Promise<void>;
  getAll(area: string): Promise<Record<string, unknown>>;
}

interface AA_Librarian {
  getProfile(): Promise<{ fields?: Record<string, unknown> } | null>;
  setProfileFields(fields: Record<string, unknown>): Promise<unknown>;
}

interface AA_Toolkit {
  datastore: { runMigrations(): Promise<void> };
  librarian: AA_Librarian;
}

declare module '@ai4a11y/toolkit/index.js' {
  export function createToolkit(ports: { kv: AA_KV; clock?: { now(): number } }): AA_Toolkit;
}

declare module '@ai4a11y/toolkit/platforms/chrome/ports.js' {
  export function chromeKV(): AA_KV;
  export function chromeClock(): { now(): number };
}

declare module '*ai4a11y-toolkit/toolkit/index.js' {
  export function createToolkit(ports: { kv: AA_KV; clock?: { now(): number } }): AA_Toolkit;
}

declare module '*ai4a11y-toolkit/toolkit/platforms/node/kv.js' {
  export function memoryKV(): AA_KV;
}
