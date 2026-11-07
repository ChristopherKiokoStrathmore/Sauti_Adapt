/** The official AI4A11y Controller is the only in-page action executor.
 * Injected by Headway after an explicit site grant; no unattended background work.
 */
import { createController, createDomReceiver } from '../../../../packages/shared/src/controller.ts';
import { capReadPort } from '../../../../packages/shared/src/page-text.ts';

type AgentWindow = typeof globalThis & { __HEADWAY_AGENT_LOADED__?: boolean };
const w = globalThis as AgentWindow;
if (!w.__HEADWAY_AGENT_LOADED__) {
  w.__HEADWAY_AGENT_LOADED__ = true;
  const documentNonce = crypto.randomUUID();
  const root = document.documentElement;
  const scroller = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : root;
  const reader = document.body instanceof HTMLElement ? document.body : root;
  const receiver = capReadPort(createDomReceiver(root, { scrollTarget: scroller }), reader);
  const controller = createController({
    control: receiver,
    operator: { abilityModel: { supportAreas: ['motor'] } },
  });
  let active = false;
  let lastAt = 0;
  const utterances = ['scroll up', 'scroll down', 'read this', 'go back'];
  const enabledKey = 'headwayAgentOrigins';

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.kind === 'HEADWAY_AGENT_IDENTITY') {
      respond({ ok: true, nonce: documentNonce, url: location.href });
      return false;
    }
    if (message?.kind !== 'HEADWAY_AGENT_ACTION') return false;
    if (message.documentNonce !== documentNonce || !utterances.includes(message.utterance)) {
      respond({ ok: false, reason: 'Page identity or action changed.' });
      return false;
    }
    const now = Date.now();
    if (active || now - lastAt < 900) {
      respond({ ok: false, reason: 'Duplicate action suppressed.' });
      return false;
    }
    active = true;
    lastAt = now;
    chrome.storage.local.get(enabledKey).then(async result => {
      const origins = result[enabledKey];
      if (!Array.isArray(origins) || !origins.includes(location.origin)) {
        respond({ ok: false, reason: 'This website is not enabled for the agent.' });
        return;
      }
      const response = await controller.handle(message.utterance);
      respond({ ok: response?.ok === true, feedback: String(response?.say ?? '').slice(0, 1800) });
    }).catch(() => {
      respond({ ok: false, reason: 'AI4A11y action was unavailable.' });
    }).finally(() => { active = false; });
    return true;
  });
}
