/**
 * WP0 smoke test: what the side-panel agent (src/agent/panel.ts) does today, on fixture sites.
 * Mock mode by default; E2E_LIVE=1 uses the real local speech API and Gemini.
 *
 * Assertions are on outcomes (did the page scroll, is confirm enabled, did the planner get
 * called) plus loose status wording, so they survive copy changes in the panel.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE, launchHeadway, startServers } from './lib.mjs';

if (LIVE) console.log('[e2e] E2E_LIVE=1: using the real speech API at http://127.0.0.1:8000');

describe('Headway agent smoke (eCitizen-like fixture)', () => {
  let servers, h;
  before(async () => {
    servers = await startServers();
    h = await launchHeadway({ siteUrl: servers.fixtures.url + '/ecitizen-like/', apiBase: servers.apiBase });
  });
  after(async () => { await h?.close(); await servers?.stop(); });

  test('connects in single-user mode and hides the personal id/token fields', async () => {
    assert.match(await h.status(), /Connected to the speech server on this laptop/);
    assert.equal(await h.panel.isHidden('#agent-user'), true);
    assert.equal(await h.panel.isHidden('#agent-token'), true);
    assert.equal(await h.panel.isHidden('#agent-profile'), true);
  });

  test('a typed instruction on a website that is not enabled is refused', async () => {
    const calls = servers.api?.requests.length ?? 0;
    const y0 = await h.scrollSettled();
    const r = await h.instruct('shuka chini');
    assert.match(r.status, /not switched on for this website|Enable this website/i);
    assert.equal(r.canConfirm, false);
    assert.equal(await h.scrollY(), y0);
    if (servers.api) assert.equal(servers.api.requests.length, calls, 'no planner call for a non-enabled site');
  });

  test('enable website', async () => {
    assert.match(await h.enable(), /Headway is on for 127\.0\.0\.1|Agent enabled on http:\/\/127\.0\.0\.1/);
  });

  test('"shuka chini" scrolls the page (after confirm, if the panel asks for one)', async () => {
    const y0 = await h.scrollY();
    let r = await h.instruct('shuka chini');
    if (r.canConfirm) r = await h.confirm();
    await h.site.waitForFunction((y) => window.scrollY > y, y0, { timeout: 5000 });
    assert.ok((await h.scrollSettled()) > y0, 'page scrolled down; status: ' + r.status);
  });

  test('"transfer all my money" → nothing done, confirm stays disabled', async () => {
    const y0 = await h.scrollSettled();
    const calls = servers.api?.requests.filter((q) => q.path.endsWith('/agent/plan')).length ?? 0;
    const r = await h.instruct('transfer all my money to this account');
    assert.match(r.status, /Nothing was done|No action/);
    assert.equal(r.canConfirm, false);
    assert.deepEqual(r.choices, []);
    assert.equal(await h.scrollY(), y0);
    if (servers.api) {
      const plans = servers.api.requests.filter((q) => q.path.endsWith('/agent/plan'));
      assert.equal(plans.length, calls + 1, 'went to the planner, which refused');
    }
  });

  test('no page errors in the panel', () => {
    assert.deepEqual(h.errors, []);
  });
});
