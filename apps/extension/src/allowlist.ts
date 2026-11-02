/** Websites the person explicitly enabled. This is not a Chrome host permission. */
export const ENABLED_ORIGINS_KEY = 'enabledOrigins';

export function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readEnabledOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins = value.filter((item): item is string => typeof item === 'string' && httpOrigin(item) === item);
  return [...new Set(origins)];
}

export function withOrigin(list: readonly string[], origin: string, enabled: boolean): string[] {
  const next = new Set(readEnabledOrigins(list));
  if (enabled) next.add(origin);
  else next.delete(origin);
  return [...next];
}
