/** The OFFICIAL AI4A11y controller runs inside the isolated content-script context. */
import { createController } from '@toolkit/controller/createController.js';
import { createDomReceiver } from '@toolkit/controller/web/dom-receiver.js';
import { TOOLKIT_UTTERANCE } from '@sauti/shared';

const win = globalThis as typeof globalThis & { __SAUTI_CONTENT_READY__?: boolean };
if (!win.__SAUTI_CONTENT_READY__) {
  win.__SAUTI_CONTENT_READY__ = true;
  const receiver = createDomReceiver(document.documentElement, {
    scrollTarget: document.scrollingElement || document.documentElement
  });
  const controller = createController({ control: receiver, operator: { abilityModel: { supportAreas: ['motor'] } } });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.kind !== 'SAUTI_APPROVED_COMMAND') return false;
    // The sender must be this extension, not a website postMessage event.
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, reason: 'Unauthorized sender' }); return false; }
    const allowed = Object.values(TOOLKIT_UTTERANCE);
    if (typeof message.utterance !== 'string' || !allowed.includes(message.utterance)) {
      respond({ ok: false, reason: 'Command is outside the allowlist' });
      return false;
    }
    controller.handle(message.utterance).then(result => {
      respond({ ok: Boolean(result.ok), pending: Boolean(result.pending), feedback: String(result.say || '') });
    }).catch(() => respond({ ok: false, reason: 'Controller did not complete.' }));
    return true;
  });
}
