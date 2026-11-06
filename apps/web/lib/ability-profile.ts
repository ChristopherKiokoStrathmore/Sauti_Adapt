/**
 * Sauti → official AI4A11y Librarian profile adapter.
 *
 * Strict privacy boundary: never put voice recordings, participant identifiers,
 * access tokens, speech condition, diagnoses, or model artifacts in this store.
 * No data is transmitted to a backend by this adapter.
 *
 * The toolkit KV 'sync' area is backed by origin-local browser storage here.
 * Cross-browser/device movement requires EXPLICIT download/import. This is not
 * the Chrome extension's own chrome.storage.sync implementation.
 */
import { createToolkit } from '@toolkit/toolkit/index.js';

export type ShareablePreferences = {
  language: 'en-KE' | 'sw-KE';
  spokenGuidance: boolean;
  clickMethod: 'mouth' | 'dwell';
  pointerSensitivity: number;
  pointerSteadiness: 'low' | 'medium' | 'high';
};
type Need = { dimension: string; value: string | number | boolean; strength: 'preference'; unit: 'enum' | 'ratio' | 'boolean'; source: 'sauti-explicit' };
export type PortableModel = {
  schemaVersion: 1;
  supportAreas: string[];
  freeText: string;
  language: string;
  readingLevel: string | null;
  confidence: number | null;
  needs: Need[];
};

const PREFIX = 'sauti.ability.v1.';
const CONSENT = PREFIX + 'consent';
let singleton: ReturnType<typeof createToolkit> | undefined;
let initialized: Promise<void> | undefined;

function localKV() {
  return {
    async get(area: string, key: string): Promise<unknown> {
      const data = window.localStorage.getItem(PREFIX + area + '.' + key);
      return data === null ? undefined : JSON.parse(data);
    },
    async set(area: string, key: string, value: unknown): Promise<void> {
      const full = PREFIX + area + '.' + key;
      if (value === undefined) window.localStorage.removeItem(full);
      else window.localStorage.setItem(full, JSON.stringify(value));
    },
    async getAll(area: string): Promise<Record<string, unknown>> {
      const prefix = PREFIX + area + '.';
      const result: Record<string, unknown> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(prefix)) {
          const v = window.localStorage.getItem(k);
          if (v !== null) result[k.slice(prefix.length)] = JSON.parse(v);
        }
      }
      return result;
    },
  };
}

export function hasAbilityConsent(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(CONSENT) === 'yes';
}

export function getBrowserToolkit(): ReturnType<typeof createToolkit> {
  if (typeof window === 'undefined') throw new Error('Browser toolkit requires a client session');
  if (!singleton) singleton = createToolkit({ kv: localKV() });
  return singleton;
}

async function ready() {
  const toolkit = getBrowserToolkit();
  if (!initialized) initialized = toolkit.datastore.runMigrations().then(() => undefined).catch(e => { initialized = undefined; throw e; });
  await initialized;
  return toolkit.librarian;
}

function safePreferences(p: ShareablePreferences): ShareablePreferences {
  if (p.language !== 'en-KE' && p.language !== 'sw-KE') throw new Error('Unsupported language');
  if (p.clickMethod !== 'mouth' && p.clickMethod !== 'dwell') throw new Error('Unsupported click method');
  if (!['low', 'medium', 'high'].includes(p.pointerSteadiness)) throw new Error('Unsupported steadiness');
  if (typeof p.spokenGuidance !== 'boolean') throw new Error('Unsupported guidance setting');
  if (typeof p.pointerSensitivity !== 'number' || !Number.isFinite(p.pointerSensitivity)) throw new Error('Unsupported sensitivity');
  return { language: p.language, spokenGuidance: p.spokenGuidance, clickMethod: p.clickMethod,
    pointerSensitivity: Math.min(1.6, Math.max(0.6, p.pointerSensitivity)), pointerSteadiness: p.pointerSteadiness };
}

function needs(p: ShareablePreferences): Need[] {
  return [
    { dimension: 'spokenGuidance', value: p.spokenGuidance, unit: 'boolean', strength: 'preference', source: 'sauti-explicit' },
    { dimension: 'selectionGesture', value: p.clickMethod, unit: 'enum', strength: 'preference', source: 'sauti-explicit' },
    { dimension: 'pointerSensitivity', value: p.pointerSensitivity, unit: 'ratio', strength: 'preference', source: 'sauti-explicit' },
    { dimension: 'pointerSteadiness', value: p.pointerSteadiness, unit: 'enum', strength: 'preference', source: 'sauti-explicit' },
  ];
}

export async function sharePreferences(p: ShareablePreferences): Promise<PortableModel> {
  // The user must actively enable sharing in the UI before any write.
  if (!hasAbilityConsent()) throw new Error('Accessibility preference sharing needs consent');
  const safe = safePreferences(p);
  const librarian = await ready();
  await librarian.setProfileFields({
    supportAreas: [], // No ability/diagnosis inference from using Headway
    freeText: '',
    'metaPreferences.language': safe.language,
    'fields.needs': needs(safe),
  });
  return model();
}

export async function model(): Promise<PortableModel> {
  if (!hasAbilityConsent()) throw new Error('Accessibility preference sharing needs consent');
  const librarian = await ready();
  const value = await librarian.getAbilityModel();
  return redact(value);
}

/** Only the explicitly authorized setting vocabulary may leave this browser. */
function redact(input: { language?: string; needs?: unknown[] }): PortableModel {
  const allowed = new Set(['spokenGuidance', 'selectionGesture', 'pointerSensitivity', 'pointerSteadiness']);
  const approved = (Array.isArray(input.needs) ? input.needs : []).filter((v): v is Need => {
    if (!v || typeof v !== 'object') return false;
    const n = v as Need;
    return allowed.has(n.dimension) && n.source === 'sauti-explicit' &&
      (typeof n.value === 'boolean' || typeof n.value === 'number' || typeof n.value === 'string');
  });
  return { schemaVersion: 1, supportAreas: [], freeText: '', language: input.language === 'sw-KE' ? 'sw-KE' : 'en-KE',
    readingLevel: null, confidence: null, needs: approved };
}

export async function importPreferences(json: string): Promise<PortableModel> {
  if (!hasAbilityConsent()) throw new Error('Enable preference sharing before import');
  if (json.length > 12000) throw new Error('Profile file is too large');
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(json) as Record<string, unknown>; } catch { throw new Error('Invalid JSON profile'); }
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.needs) || parsed.supportAreas?.length) {
    throw new Error('Only Sauti preference-only AbilityModel files can be imported');
  }
  const values = Object.fromEntries(parsed.needs.filter((n): n is Need =>
    n !== null && typeof n === 'object' && 'dimension' in n && 'value' in n &&
    ['spokenGuidance', 'selectionGesture', 'pointerSensitivity', 'pointerSteadiness'].includes(String(n.dimension))
  ).map(n => [n.dimension, n.value]));
  const p = safePreferences({
    language: parsed.language === 'sw-KE' ? 'sw-KE' : 'en-KE',
    spokenGuidance: values.spokenGuidance === true,
    clickMethod: values.selectionGesture === 'dwell' ? 'dwell' : 'mouth',
    pointerSensitivity: typeof values.pointerSensitivity === 'number' ? values.pointerSensitivity : 1,
    pointerSteadiness: ['low', 'medium', 'high'].includes(String(values.pointerSteadiness))
      ? values.pointerSteadiness as ShareablePreferences['pointerSteadiness'] : 'medium',
  });
  return sharePreferences(p);
}

export function enableAbilityConsent() {
  window.localStorage.setItem(CONSENT, 'yes');
}

export function withdrawAbilityConsent() {
  // Drop BOTH storage areas. Nothing is kept for a future page visit.
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  }
  singleton = undefined;
  initialized = undefined;
}
