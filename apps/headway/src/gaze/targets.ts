/**
 * Finding what the head pointer is aiming at (Research/001, solution A).
 *
 * Nutshell snapped only to links, so buttons such as YouTube's Skip got no help.
 * This snaps to anything clickable and measures distance to the target's *edge*
 * (bubble cursor, Grossman & Balakrishnan 2005): a pointer anywhere over a target
 * has distance 0, and a small button is as easy to reach as its surroundings allow.
 */

export const CLICKABLE_SELECTOR = [
  'a[href]', 'button', 'summary', 'select', 'textarea', 'label[for]',
  'input:not([type="hidden"])',
  '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
  '[role="switch"]', '[role="option"]', '[role="slider"]',
  '[onclick]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  '.ytp-button'
].join(',');

export interface Box { left: number; top: number; right: number; bottom: number }
export interface Candidate<T = HTMLElement> { element: T; distance: number }

/** Distance from a point to the nearest edge of a box; 0 when the point is inside. */
export function edgeDistance(x: number, y: number, box: Box): number {
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy);
}

/**
 * A click is ambiguous when the two nearest targets are both within reach and
 * neither is clearly closer. Being inside a target (distance 0) is never ambiguous
 * unless the second one is also under the pointer.
 */
export function isAmbiguous(sorted: { distance: number }[], reach: number, margin: number): boolean {
  if (sorted.length < 2) return false;
  const [first, second] = sorted;
  if (first.distance > reach || second.distance > reach) return false;
  return second.distance - first.distance < margin;
}

// ---------- DOM side ----------

const IGNORE_IDS = new Set(['gaze-pointer', 'gaze-cam', 'gaze-debug-hud', 'gaze-scroll-zones', 'gaze-dwell-indicator']);
let cache: HTMLElement[] = [];
let cacheAt = Number.NEGATIVE_INFINITY; // "never filled": refresh on first use
const CACHE_MS = 600;
const MAX_SCAN = 1500;

function candidatesInDocument(): HTMLElement[] {
  const now = performance.now();
  if (now - cacheAt > CACHE_MS) {
    cache = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).slice(0, MAX_SCAN);
    cacheAt = now;
  }
  return cache;
}

/** Drop the cached element list (call after the page changes a lot, e.g. a picker opens). */
export function invalidateTargets() {
  cacheAt = Number.NEGATIVE_INFINITY;
}

function isHeadwayChrome(el: Element): boolean {
  return IGNORE_IDS.has(el.id) || !!el.closest('#gaze-scroll-zones');
}

/** The clickable element at or above `el`, if any. Falls back to cursor: pointer for div-buttons. */
export function closestClickable(el: Element | null): HTMLElement | null {
  if (!el || isHeadwayChrome(el)) return null;
  const direct = el.closest<HTMLElement>(CLICKABLE_SELECTOR);
  if (direct) return direct;
  let node: Element | null = el;
  for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
    if (node instanceof HTMLElement && getComputedStyle(node).cursor === 'pointer') return node;
  }
  return null;
}

/** True when the element can actually receive a click at some point near (x, y). */
function isHittable(el: HTMLElement, rect: DOMRect, x: number, y: number): boolean {
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  const probes: [number, number][] = [
    [Math.min(Math.max(x, rect.left + 1), rect.right - 1), Math.min(Math.max(y, rect.top + 1), rect.bottom - 1)],
    [rect.left + rect.width / 2, rect.top + rect.height / 2]
  ];
  return probes.some(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return !!hit && (hit === el || el.contains(hit));
  });
}

/** Clickable elements whose edge is within `reach` px of (x, y), nearest first. */
export function clickablesNear(x: number, y: number, reach: number, limit = 8): Candidate[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const found: Candidate[] = [];
  for (const el of candidatesInDocument()) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) continue;
    const distance = edgeDistance(x, y, rect);
    if (distance <= reach && !isHeadwayChrome(el)) found.push({ element: el, distance });
  }
  found.sort((a, b) => a.distance - b.distance);
  // When clickables nest (a button inside a link card), keep the innermost one the
  // pointer is equally close to: it is the more specific target.
  const result: Candidate[] = [];
  for (const cand of found) {
    if (result.length >= limit) break;
    if (result.some((kept) => cand.element.contains(kept.element))) continue;
    const outer = result.findIndex((kept) => kept.element.contains(cand.element));
    if (outer !== -1 && cand.distance > result[outer].distance) continue;
    if (!isHittable(cand.element, cand.element.getBoundingClientRect(), x, y)) continue;
    if (outer !== -1) result.splice(outer, 1, cand);
    else result.push(cand);
  }
  return result;
}

/** A short, human label for a target, used by the precision picker. */
export function describeTarget(el: HTMLElement): string {
  const pick = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const text =
    pick(el.getAttribute('aria-label')) ||
    pick(el.getAttribute('title')) ||
    pick(el.innerText) ||
    pick((el as HTMLInputElement).value) ||
    pick(el.querySelector('img')?.getAttribute('alt')) ||
    pick(el.getAttribute('placeholder'));
  if (text) return text.length > 40 ? text.slice(0, 39) + '…' : text;
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  return role === 'a' ? 'Link' : role.charAt(0).toUpperCase() + role.slice(1);
}
