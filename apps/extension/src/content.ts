/** The OFFICIAL AI4A11y controller runs inside the isolated content-script context. */
import { TOOLKIT_UTTERANCE } from '@sauti/shared';
import { createController, createDomReceiver } from '@sauti/shared/controller';
import { ENABLED_ORIGINS_KEY, httpOrigin, readEnabledOrigins } from './allowlist';
import { capReadPort } from '@sauti/shared/page-text';

const win = globalThis as typeof globalThis & { __SAUTI_CONTENT_READY__?: boolean };
if (!win.__SAUTI_CONTENT_READY__) {
  win.__SAUTI_CONTENT_READY__ = true;
  const root = document.documentElement;
  const scroller = (document.scrollingElement instanceof HTMLElement ? document.scrollingElement : root);
  const readRoot = document.body instanceof HTMLElement ? document.body : root;
  const receiver = capReadPort(createDomReceiver(root, { scrollTarget: scroller }), readRoot);
  const controller = createController({
    control: receiver,
    operator: { abilityModel: { supportAreas: ['motor'] } },
  });
  const documentNonce = crypto.randomUUID();
  let approvedCommandInFlight = false;
  let lastApprovedCommandAt = 0;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, reason: 'Unauthorized sender' }); return false; }
    if (message?.kind === 'SAUTI_PAGE_IDENTITY') {
      respond({ ok: true, nonce: documentNonce, href: location.href });
      return false;
    }
    const manual = message?.kind === 'SAUTI_MANUAL_COMMAND';
    if (message?.kind !== 'SAUTI_APPROVED_COMMAND' && !manual) return false;
    if (!manual && message.documentNonce !== documentNonce) {
      respond({ ok: false, reason: 'This page changed since you started speaking. No action was taken.' });
      return false;
    }
    // "what's on screen" is the official outline query. It is read-only.
    const allowed = [...Object.values(TOOLKIT_UTTERANCE), "what's on screen"];
    if (typeof message.utterance !== 'string' || !allowed.includes(message.utterance)) {
      respond({ ok: false, reason: 'Command is outside the allowlist' });
      return false;
    }
    // A second recognition response must not cause a duplicate action while
    // the first is running or immediately after it completes.
    if (!manual) {
      const now = Date.now();
      if (approvedCommandInFlight || now - lastApprovedCommandAt < 900) {
        respond({ ok: false, reason: 'Duplicate voice command suppressed.' });
        return false;
      }
      approvedCommandInFlight = true;
      lastApprovedCommandAt = now;
    }
    const finishApproved = () => { if (!manual) approvedCommandInFlight = false; };
    const origin = httpOrigin(location.href);
    chrome.storage.local.get(ENABLED_ORIGINS_KEY).then(stored => {
      const enabled = readEnabledOrigins(stored[ENABLED_ORIGINS_KEY]);
      if (!origin || !enabled.includes(origin)) {
        finishApproved();
        respond({ ok: false, reason: 'This website is not enabled.' });
        return;
      }
      controller.handle(message.utterance).then(result => {
        const pending = Boolean(result && typeof result === 'object' && 'pending' in result && result.pending);
        finishApproved();
        respond({ ok: Boolean(result.ok), pending, feedback: String(result.say || '') });
      }).catch(() => { finishApproved(); respond({ ok: false, reason: 'Controller did not complete.' }); });
    }).catch(() => { finishApproved(); respond({ ok: false, reason: 'This website is not enabled.' }); });
    return true;
  });
}
