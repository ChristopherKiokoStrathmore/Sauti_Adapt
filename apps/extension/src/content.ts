/** The OFFICIAL AI4A11y controller runs inside the isolated content-script context. */
import { TOOLKIT_UTTERANCE } from '@sauti/shared';
import { createController, createDomReceiver } from '@sauti/shared/controller';
import { ENABLED_ORIGINS_KEY, httpOrigin, readEnabledOrigins } from './allowlist';
import { capReadPort } from './page-text';

const win = globalThis as typeof globalThis & { __SAUTI_CONTENT_READY__?: boolean };
if (!win.__SAUTI_CONTENT_READY__) {
  win.__SAUTI_CONTENT_READY__ = true;
  const root = document.documentElement;
  const scroller = (document.scrollingElement instanceof HTMLElement ? document.scrollingElement : root);
  const receiver = capReadPort(
    createDomReceiver(root, { scrollTarget: scroller }),
    () => document.body?.innerText || '',
  );
  const controller = createController({
    control: receiver,
    operator: { abilityModel: { supportAreas: ['motor'] } },
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.kind !== 'SAUTI_APPROVED_COMMAND') return false;
    // The sender must be this extension, not a website postMessage event.
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, reason: 'Unauthorized sender' }); return false; }
    const allowed = Object.values(TOOLKIT_UTTERANCE);
    if (typeof message.utterance !== 'string' || !allowed.includes(message.utterance)) {
      respond({ ok: false, reason: 'Command is outside the allowlist' });
      return false;
    }
    const origin = httpOrigin(location.href);
    chrome.storage.local.get(ENABLED_ORIGINS_KEY).then(stored => {
      const enabled = readEnabledOrigins(stored[ENABLED_ORIGINS_KEY]);
      if (!origin || !enabled.includes(origin)) {
        respond({ ok: false, reason: 'This website is not enabled.' });
        return;
      }
      controller.handle(message.utterance).then(result => {
        const pending = Boolean(result && typeof result === 'object' && 'pending' in result && result.pending);
        respond({ ok: Boolean(result.ok), pending, feedback: String(result.say || '') });
      }).catch(() => respond({ ok: false, reason: 'Controller did not complete.' }));
    }).catch(() => respond({ ok: false, reason: 'This website is not enabled.' }));
    return true;
  });
}
