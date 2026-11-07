/** The official AI4A11y Controller is the only in-page action executor.
 * Injected by Headway after an explicit site grant; no unattended background work.
 */
import { createController, createDomReceiver } from '../../../../packages/shared/src/controller.ts';
import { capReadPort } from '../../../../packages/shared/src/page-text.ts';
import { snapshot, click, focus, type, choose, chooseOption, showBadges, clearBadges, type PageResult } from '../harness/page.ts';

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
    if (message?.kind === 'HEADWAY_AGENT_PAGE') {
      // Harness page operations (docs/harness/AGENT_V2_CONTRACT.md). Same guards as actions:
      // this exact document, and only on a website she enabled.
      if (message.documentNonce !== documentNonce) {
        respond({ ok: false, reason: 'Page identity changed.' });
        return false;
      }
      chrome.storage.local.get(enabledKey).then((result) => {
        const origins = result[enabledKey];
        if (!Array.isArray(origins) || !origins.includes(location.origin)) {
          respond({ ok: false, reason: 'This website is not enabled for the agent.' });
          return;
        }
        const op = String(message.op || '');
        let out: PageResult | ({ ok: true } & ReturnType<typeof snapshot>);
        if (op === 'snapshot') out = { ok: true, ...snapshot() };
        else if (op === 'click') out = click(String(message.id));
        else if (op === 'focus') out = focus(String(message.id));
        else if (op === 'type') out = type(String(message.text ?? ''), message.id ? String(message.id) : undefined);
        else if (op === 'choose') out = choose(String(message.id), message.option ? String(message.option) : undefined, typeof message.check === 'boolean' ? message.check : undefined);
        else if (op === 'chooseOption') out = chooseOption(String(message.option ?? ''));
        else if (op === 'badges') out = showBadges(Array.isArray(message.ids) ? message.ids.map(String).slice(0, 3) : []);
        else if (op === 'clear') out = clearBadges();
        else out = { ok: false, reason: 'Unknown page operation.' };
        respond(out);
      }).catch(() => respond({ ok: false, reason: 'Page operation unavailable.' }));
      return true;
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
