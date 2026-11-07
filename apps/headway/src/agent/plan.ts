/** Pure, fail-closed validation of Gemini's single proposed browser action. */
export type BrowserPlan =
  | { action: 'search_web'; query: string }
  | { action: 'open_url'; url: string }
  | { action: 'scroll'; direction: 'up' | 'down' }
  | { action: 'read_page' | 'go_back' }
  | { action: 'none'; reason: string }
  // Agent v2 (docs/harness/AGENT_V2_CONTRACT.md): elements by id from the page snapshot.
  | { action: 'click' | 'focus'; target_id: string }
  | { action: 'clarify'; question: string; options: string[] };

export function publicHttpsUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 1200 || /\s/.test(raw)) throw new Error('Invalid website URL.');
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Invalid website URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || u.port && u.port !== '443') {
    throw new Error('Only public HTTPS sites are supported.');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host === '0.0.0.0'
    || /^\d+\.\d+\.\d+\.\d+$/.test(host)
    || host === '[::1]' || host.includes(':') || host.includes('%') || !host.includes('.')) {
    throw new Error('Private, internal or IP addresses are not supported.');
  }
  if (!host.split('.').every(x => /^[a-z0-9-]+$/.test(x))) throw new Error('Invalid website hostname.');
  if (u.hash) throw new Error('URL fragments are not supported.');
  return u;
}

export function validateBrowserPlan(value: unknown, allowedIds: ReadonlySet<string> = new Set()): BrowserPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Gemini response.');
  const v = value as Record<string, unknown>;
  switch (v.action) {
    case 'search_web':
      if (typeof v.query !== 'string' || !v.query.trim() || v.query.length > 180) throw new Error('Invalid search text.');
      return { action: 'search_web', query: v.query.trim() };
    case 'open_url':
      if (typeof v.url !== 'string') throw new Error('Invalid website URL.');
      return { action: 'open_url', url: publicHttpsUrl(v.url).toString() };
    case 'scroll':
      if (v.direction !== 'up' && v.direction !== 'down') throw new Error('Invalid scroll direction.');
      return { action: 'scroll', direction: v.direction };
    case 'read_page': return { action: 'read_page' };
    case 'go_back': return { action: 'go_back' };
    case 'none': return { action: 'none', reason: typeof v.reason === 'string' ? v.reason.slice(0, 180) : 'Please clarify the request.' };
    case 'click':
    case 'focus':
      if (typeof v.target_id !== 'string' || !allowedIds.has(v.target_id)) throw new Error('Gemini chose something that is not on this page.');
      return { action: v.action, target_id: v.target_id };
    case 'clarify': {
      const opts = Array.isArray(v.options) ? v.options.map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>).target_id : null)) : [];
      if (typeof v.question !== 'string' || !v.question.trim() || v.question.length > 160) throw new Error('Invalid clarifying question.');
      if (opts.length < 2 || opts.length > 3 || new Set(opts).size !== opts.length || !opts.every((o) => typeof o === 'string' && allowedIds.has(o))) {
        throw new Error('Gemini offered choices that are not on this page.');
      }
      return { action: 'clarify', question: v.question.trim(), options: opts as string[] };
    }
    default: throw new Error('Gemini proposed an unsupported action.');
  }
}

export function actionDescription(plan: BrowserPlan): string {
  switch (plan.action) {
    case 'search_web': return 'Search Google for: ' + plan.query;
    case 'open_url': return 'Open ' + plan.url;
    case 'scroll': return 'Scroll ' + plan.direction;
    case 'read_page': return 'Read this page aloud';
    case 'go_back': return 'Go back one page';
    case 'none': return 'No action: ' + plan.reason;
    case 'click': return 'Press an item on the page';
    case 'focus': return 'Go to a field on the page';
    case 'clarify': return plan.question;
  }
}

export function searchUrl(query: string): string {
  return 'https://www.google.com/search?q=' + encodeURIComponent(query);
}
