/**
 * Real ("trusted") clicks through the Chrome DevTools Protocol (Research/001, solution E).
 *
 * A click made with dispatchEvent() carries isTrusted: false, and some sites ignore it.
 * YouTube's Skip button is one. Input.dispatchMouseEvent goes through Chrome's own input
 * pipeline, so the page receives a normal, trusted mouse click.
 *
 * Cost: while attached, Chrome shows "Headway started debugging this browser". Headway
 * attaches to a tab only when it first needs to click there, stays attached while head
 * tracking is on (so the bar does not flash on every click), and detaches when tracking
 * or real clicks are turned off. If the person presses Cancel on Chrome's bar, the
 * session ends, and the content script falls back to synthetic clicks.
 */
import type { RuntimeMessage } from '../shared/types';
import { errorMessage } from '../shared/types';

const PROTOCOL = '1.3';
const attached = new Set<number>();
const attaching = new Map<number, Promise<void>>();

function attach(tabId: number): Promise<void> {
  if (attached.has(tabId)) return Promise.resolve();
  const pending = attaching.get(tabId);
  if (pending) return pending;
  const p = chrome.debugger
    .attach({ tabId }, PROTOCOL)
    .then(() => {
      attached.add(tabId);
    })
    .catch((error: unknown) => {
      // Already attached by us in an earlier worker life is fine; anything else is a real failure.
      if (/already attached/i.test(errorMessage(error))) {
        attached.add(tabId);
        return;
      }
      throw error;
    })
    .finally(() => attaching.delete(tabId));
  attaching.set(tabId, p);
  return p;
}

async function detachAll() {
  const tabs = [...attached];
  attached.clear();
  await Promise.all(tabs.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => {})));
}

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId === 'number') attached.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.gazeEnabled && changes.gazeEnabled.newValue === false) void detachAll();
  if (changes.trustedClicks && changes.trustedClicks.newValue === false) void detachAll();
});

function send(tabId: number, method: string, params: Record<string, unknown>) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

/** Click at (x, y), in CSS pixels relative to the tab's top-level viewport. */
export async function trustedClick(tabId: number, x: number, y: number, button: 'left' | 'right' = 'left') {
  await attach(tabId);
  const base = { x, y, pointerType: 'mouse' as const };
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', buttons: 0 });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button, buttons: button === 'left' ? 1 : 2, clickCount: 1 });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button, buttons: 0, clickCount: 1 });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type !== 'TRUSTED_CLICK') return;
  const tabId = sender.tab?.id;
  const x = Number(message.x);
  const y = Number(message.y);
  // Only the top frame sends these, so its viewport coordinates are the tab's.
  if (typeof tabId !== 'number' || sender.frameId !== 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    sendResponse({ ok: false, error: 'BAD_REQUEST' });
    return;
  }
  trustedClick(tabId, x, y, message.button === 'right' ? 'right' : 'left')
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

// Handle for checks run from the service-worker console or automated tests.
(globalThis as { headwayTrustedClick?: typeof trustedClick }).headwayTrustedClick = trustedClick;
