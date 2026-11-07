/** Human-confirmed, single-action Gemini browser navigation pilot.
 * Gemini only proposes actions; all DOM actions still go through AI4A11y.
 * The user's key never enters the extension.
 */
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { speakText } from '@sauti/shared/speak';
import { ENABLED_ORIGINS_KEY, readEnabledOrigins } from './allowlist';

type AgentPlan =
  | { action: 'search_web'; query: string }
  | { action: 'open_url'; url: string }
  | { action: 'scroll'; direction: 'up' | 'down' }
  | { action: 'read_page' | 'go_back' }
  | { action: 'none'; reason: string };
type PageBinding = { tabId: number; url: string; origin: string; nonce: string; userId: string; token: string };
type Pending = { plan: AgentPlan; binding: PageBinding };

export function initBrowserAgent() {
  const el = (id: string) => document.getElementById(id) as HTMLInputElement;
  const prompt = el('agent-text');
  const status = document.getElementById('agent-status')!;
  const speech = el('agent-voice') as HTMLButtonElement;
  const confirm = el('agent-confirm') as HTMLButtonElement;
  const cancel = el('agent-cancel') as HTMLButtonElement;
  let voiceRecording: RecordingSession | null = null;
  let voicePage: PageBinding | null = null;
  let pending: Pending | null = null;
  let busy = false;

  const say = (s: string) => { status.textContent = s; };
  const apiOrigin = () => el('api').value.trim();
  const credentials = () => ({
    userId: el('user').value.trim(),
    token: el('code').value.trim(),
    profileId: el('profile').value.trim(),
  });
  function clearPending() { pending = null; confirm.disabled = true; }

  async function capturePage(): Promise<PageBinding> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Select an ordinary website tab.');
    const origin = new URL(tab.url).origin;
    const stored = await chrome.storage.local.get(ENABLED_ORIGINS_KEY);
    if (!readEnabledOrigins(stored[ENABLED_ORIGINS_KEY]).includes(origin)
      || !(await chrome.permissions.contains({ origins: [origin + '/*'] }))) {
      throw new Error('Use Enable current website before using the agent.');
    }
    const { userId, token } = credentials();
    if (!userId || !token) throw new Error('Enter your personal user ID and access token.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const identity = await chrome.tabs.sendMessage(tab.id, { kind: 'SAUTI_PAGE_IDENTITY' });
    if (!identity?.ok || identity.href !== tab.url || typeof identity.nonce !== 'string')
      throw new Error('The active page changed.');
    return { tabId: tab.id, url: tab.url, origin, nonce: identity.nonce, userId, token };
  }

  async function stillSamePage(page: PageBinding): Promise<boolean> {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active[0]?.id !== page.tabId) return false;
    const tab = await chrome.tabs.get(page.tabId).catch(() => null);
    if (tab?.url !== page.url) return false;
    const { userId, token } = credentials();
    if (userId !== page.userId || token !== page.token) return false;
    const stored = await chrome.storage.local.get(ENABLED_ORIGINS_KEY);
    if (!readEnabledOrigins(stored[ENABLED_ORIGINS_KEY]).includes(page.origin)) return false;
    if (!(await chrome.permissions.contains({ origins: [page.origin + '/*'] }))) return false;
    const identity = await chrome.tabs.sendMessage(page.tabId, { kind: 'SAUTI_PAGE_IDENTITY' }).catch(() => null);
    return identity?.ok === true && identity.nonce === page.nonce && identity.href === page.url;
  }

  async function requestJson(path: string, page: PageBinding, data: object) {
    const url = new URL(path, apiOrigin());
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
      throw new Error('The speech and agent API must use HTTPS.');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sauti-user': page.userId,
        'x-sauti-user-token': page.token,
      },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body?.detail || body?.error || 'Agent API unavailable.'));
    return body;
  }

  async function planInstruction(text: string, page: PageBinding) {
    clearPending();
    if (!text.trim()) throw new Error('Enter or speak a browser instruction.');
    say('Asking Gemini to propose an action…');
    const data = await requestJson('/api/agent/plan', page, { instruction: text.trim(), page_url: page.url });
    const action = data?.plan as AgentPlan | undefined;
    if (!action || typeof action.action !== 'string' || data.executed_action !== false
        || data.requires_confirmation !== true) throw new Error('Invalid agent plan.');
    if (!(await stillSamePage(page))) throw new Error('Page or session changed during planning. No action taken.');
    if (action.action === 'none') {
      say('No action proposed. ' + String(action.reason || 'Please clarify the request.'));
      return;
    }
    const labels: Record<string, string> = {
      search_web: 'Search Google for: ' + ('query' in action ? action.query : ''),
      open_url: 'Open: ' + ('url' in action ? action.url : ''),
      scroll: 'Scroll ' + ('direction' in action ? action.direction : ''),
      read_page: 'Read this page aloud',
      go_back: 'Navigate back',
    };
    pending = { plan: action, binding: page };
    confirm.disabled = false;
    say('Gemini proposes: ' + (labels[action.action] || action.action) + '\nReview, then select Confirm and execute.');
  }

  el('agent-plan').addEventListener('click', () => {
    if (busy || voiceRecording) return;
    busy = true;
    void (async () => {
      try { await planInstruction(prompt.value, await capturePage()); }
      catch (error) { clearPending(); say('No action taken: ' + String(error)); }
      finally { busy = false; }
    })();
  });

  async function finishVoice() {
    const session = voiceRecording;
    const page = voicePage;
    if (!session || !page || busy) return;
    voiceRecording = null;
    voicePage = null;
    speech.textContent = 'Record voice instruction';
    busy = true;
    try {
      say('Transcribing speech with the selected fine tuned model…');
      const audio = await session.stop();
      const form = new FormData();
      const model = (document.getElementById('agent-language') as HTMLSelectElement).value;
      form.append('audio', audio, 'speech.wav');
      form.append('profile_id', credentials().profileId);
      form.append('language', model === 'swahili' ? 'sw-KE' : 'en-KE');
      form.append('model', model);
      form.append('compare_consent', 'true');
      const url = new URL('/api/compare', apiOrigin());
      const response = await fetch(url, {
        method: 'POST',
        body: form,
        headers: { 'x-sauti-user': page.userId, 'x-sauti-user-token': page.token },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(String(result?.detail || result?.error || 'Speech API unavailable.'));
      const row = result?.results?.find((item: { model?: string }) => item.model === model);
      const transcript = row?.transcript;
      if (typeof transcript !== 'string' || !transcript.trim())
        throw new Error('No usable transcript. The model may be unavailable or the speech was not recognized.');
      if (!(await stillSamePage(page))) throw new Error('Page changed during transcription.');
      prompt.value = transcript;
      await planInstruction(transcript, page);
    } catch (error) { clearPending(); say('No action taken: ' + String(error)); }
    finally { busy = false; }
  }

  speech.addEventListener('click', () => {
    if (busy) return;
    if (voiceRecording) { void finishVoice(); return; }
    void (async () => {
      try {
        if (!el('agent-consent').checked) throw new Error('Confirm audio comparison consent first.');
        if (!credentials().profileId) throw new Error('Enter the private voice profile ID.');
        const page = await capturePage();
        clearPending();
        const maxMs = clampClipMs(Number(el('maxsec').value) * 1000);
        voicePage = page;
        voiceRecording = await startRecording({
          maxDurationMs: maxMs, autoStop: true,
          onAutoStop: () => { void finishVoice(); },
        });
        speech.textContent = 'Stop and transcribe';
        say('Listening only because you pressed Record. Press again to stop.');
      } catch (error) { voiceRecording = null; voicePage = null; say('No action taken: ' + String(error)); }
    })();
  });

  confirm.addEventListener('click', () => {
    if (busy || !pending) return;
    busy = true;
    void (async () => {
      const selected = pending;
      clearPending();
      try {
        if (!(await stillSamePage(selected.binding))) throw new Error('Page or session changed. Request cancelled.');
        const { plan, binding } = selected;
        if (plan.action === 'search_web') {
          if (!plan.query || plan.query.length > 180) throw new Error('Invalid search query.');
          await chrome.tabs.update(binding.tabId, { url: 'https://www.google.com/search?q=' + encodeURIComponent(plan.query) });
          say('Google search opened. Enable the new website before another command.');
          return;
        }
        if (plan.action === 'open_url') {
          const url = new URL(plan.url);
          if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost')
            throw new Error('Only public HTTPS pages are allowed.');
          await chrome.tabs.update(binding.tabId, { url: url.toString() });
          say('Website opened. Enable the new website before another command.');
          return;
        }
        const utterance = plan.action === 'scroll' ? (plan.direction === 'down' ? 'scroll down' : 'scroll up')
          : plan.action === 'read_page' ? 'read this'
          : plan.action === 'go_back' ? 'go back' : '';
        if (!utterance) throw new Error('Unsupported action.');
        const reply = await chrome.tabs.sendMessage(binding.tabId, { kind: 'SAUTI_MANUAL_COMMAND', utterance });
        if (!reply?.ok) throw new Error(String(reply?.reason || 'AI4A11y did not complete the action.'));
        say(String(reply.feedback || 'Action completed.'));
        if (plan.action === 'read_page' && reply.feedback) speakText(reply.feedback, 'en-KE');
      } catch (error) { say('No action executed: ' + String(error)); }
      finally { busy = false; }
    })();
  });

  cancel.addEventListener('click', () => {
    clearPending();
    if (voiceRecording) {
      const discarded = voiceRecording;
      voiceRecording = null;
      voicePage = null;
      speech.textContent = 'Record voice instruction';
      void discarded.stop().catch(() => undefined);
    }
    say('Cancelled. No action executed.');
  });
}
