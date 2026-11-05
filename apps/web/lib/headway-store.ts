/** A validated published Chrome Web Store listing, never a ZIP or an untrusted redirect. */
export function getHeadwayStoreUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_HEADWAY_CHROME_WEB_STORE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'chromewebstore.google.com' ||
      !/^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
