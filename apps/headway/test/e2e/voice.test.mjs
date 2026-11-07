/**
 * Fake-microphone plumbing: Chrome plays a generated WAV as the microphone (once, then silence),
 * the panel listens after consent, posts the audio to /v1/extension/compare, and acts on the
 * transcript.
 *
 * In mock mode the transcript is FIXED by the mock (it does not listen to the audio), so this
 * proves the listen → upload → act path, not recognition. With E2E_LIVE=1 the real speech model
 * transcribes the synthetic `say` voice (not her voice: no accuracy claim either way).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchHeadway, makeWav, startServers } from './lib.mjs';

const wav = makeWav('Scroll down', { name: 'scroll-down' });

describe('voice instruction through the fake microphone', { skip: !wav && 'needs macOS say/afconvert' }, () => {
  let servers, h;
  before(async () => {
    servers = await startServers({ transcript: 'scroll down' });
    h = await launchHeadway({ siteUrl: servers.fixtures.url + '/ecitizen-like/', apiBase: servers.apiBase, wav });
    await h.enable();
  });
  after(async () => { await h?.close(); await servers?.stop(); });

  test('listening without consent is refused and nothing is uploaded', async () => {
    if (await h.panel.isChecked('#agent-consent')) await h.panel.uncheck('#agent-consent');
    const r = await h.speak();
    assert.match(r.status, /consent/i);
    if (servers.api) assert.equal(servers.api.requests.filter((q) => q.path.endsWith('/compare')).length, 0);
  });

  test('speak → transcribe → page scrolls', async () => {
    await h.panel.check('#agent-consent');
    await h.panel.selectOption('#agent-model', 'english');
    const y0 = await h.scrollY();
    let r = await h.speak();
    if (r.canConfirm) r = await h.confirm();
    if (servers.api) {
      const upload = servers.api.requests.find((q) => q.path.endsWith('/compare'));
      assert.ok(upload && upload.bytes > 10000, 'audio was uploaded as multipart; status: ' + r.status);
      assert.equal(await h.panel.inputValue('#agent-instruction'), 'scroll down');
    }
    await h.site.waitForFunction((y) => window.scrollY > y, y0, { timeout: 5000 });
  });
});
