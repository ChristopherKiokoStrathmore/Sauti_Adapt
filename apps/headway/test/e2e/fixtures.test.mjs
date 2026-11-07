/**
 * Fixture inventory checks: every page loads with Headway installed, says it is a test fixture,
 * scrolls (or is short on purpose), makes no external requests, and behaves as the scenarios need.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchHeadway, mockPlan, startServers } from './lib.mjs';

const PAGES = [
  { path: '/ecitizen-like/index.html', scrolls: true },
  { path: '/ecitizen-like/login.html', scrolls: true },
  { path: '/ecitizen-like/good-conduct.html', scrolls: true },
  { path: '/ecitizen-like/result.html', scrolls: false }, // confirmation page: short by design
  { path: '/stubborn/index.html', scrolls: true },
  { path: '/ambiguous/index.html', scrolls: true },
];

describe('fixture sites', () => {
  let servers, h;
  const external = [];
  before(async () => {
    servers = await startServers();
    h = await launchHeadway({ siteUrl: servers.fixtures.url + '/ecitizen-like/', apiBase: servers.apiBase });
    h.site.on('request', (r) => {
      const u = r.url();
      if (/^https?:/.test(u) && !u.startsWith(servers.fixtures.url)) external.push(u);
    });
  });
  after(async () => { await h?.close(); await servers?.stop(); });

  for (const page of PAGES) {
    test(`${page.path} loads, is marked as a fixture, ${page.scrolls ? 'scrolls' : 'is short on purpose'}`, async () => {
      const res = await h.site.goto(servers.fixtures.url + page.path, { waitUntil: 'load' });
      assert.equal(res.status(), 200);
      assert.match(await h.site.title(), /TEST FIXTURE/);
      assert.match(await h.site.textContent('footer'), /TEST FIXTURE/);
      const overflow = await h.site.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
      if (page.scrolls) assert.ok(overflow > 200, `expected to scroll at 1100x800, overflow=${overflow}`);
    });
  }

  test('eCitizen-like home has the eight service tiles and Sign in / Register', async () => {
    await h.site.goto(servers.fixtures.url + '/ecitizen-like/', { waitUntil: 'load' });
    for (const name of ['Apply for a Passport', 'Apply for a Driving License', 'KRA Services', 'Apply for a Birth Certificate',
      'Apply for Certificate of Good Conduct', 'Save for Affordable Housing', 'Register a Business', 'Apply for a Marriage Certificate']) {
      assert.equal(await h.site.getByRole('link', { name: new RegExp('^' + name) }).count(), 1, name);
    }
    assert.equal(await h.site.getByRole('button', { name: 'Sign in' }).count(), 1);
    assert.equal(await h.site.getByRole('button', { name: 'Register' }).count(), 1);
  });

  test('login submits only to result.html and never shows the password', async () => {
    await h.site.goto(servers.fixtures.url + '/ecitizen-like/login.html', { waitUntil: 'load' });
    await h.site.getByLabel('Email address or ID number').fill('fixture@example.test');
    await h.site.getByLabel('Password', { exact: true }).fill('not-a-real-password');
    await h.site.getByLabel('Remember for 30 days').check();
    for (const b of ['Login with OTP', 'Sign in with Digital ID']) assert.equal(await h.site.getByRole('button', { name: b }).count(), 1);
    assert.equal(await h.site.getByRole('link', { name: 'Forgot Password' }).count(), 1);
    await h.site.getByRole('button', { name: 'Sign In', exact: true }).click();
    await h.site.waitForURL(/\/ecitizen-like\/result\.html\?/);
    assert.equal(await h.site.textContent('#result-title'), 'Submitted');
    assert.equal(await h.site.textContent('dd[data-name="password"]'), '(hidden)');
    assert.doesNotMatch(await h.site.textContent('main'), /not-a-real-password/);
  });

  test('good conduct form: numeric ID, county select, agree, "Pay KSh 1,050" → result', async () => {
    await h.site.goto(servers.fixtures.url + '/ecitizen-like/good-conduct.html', { waitUntil: 'load' });
    assert.equal(await h.site.getAttribute('#id-number', 'inputmode'), 'numeric');
    await h.site.fill('#id-number', '12345678');
    await h.site.selectOption('#county', 'Nairobi');
    await h.site.getByLabel('I agree to the terms').check();
    await h.site.getByRole('button', { name: 'Pay KSh 1,050' }).click();
    await h.site.waitForURL(/result\.html\?/);
    assert.equal(await h.site.textContent('dd[data-name="county"]'), 'Nairobi');
  });

  test('stubborn button ignores synthetic clicks and accepts trusted ones', async () => {
    await h.site.goto(servers.fixtures.url + '/stubborn/', { waitUntil: 'load' });
    await h.site.evaluate(() => document.getElementById('skip').click());
    assert.equal(await h.site.textContent('#outcome'), 'Ignored synthetic click');
    await h.site.click('#skip'); // Playwright uses CDP input: a trusted click
    assert.equal(await h.site.textContent('#outcome'), 'Clicked (trusted)');
  });

  test('ambiguous page has three Certificate links and Sign in / Sign up', async () => {
    await h.site.goto(servers.fixtures.url + '/ambiguous/', { waitUntil: 'load' });
    assert.equal(await h.site.getByRole('link', { name: /Certificate/ }).count(), 3);
    assert.equal(await h.site.getByRole('button', { name: /^Sign (in|up)$/ }).count(), 2);
  });

  test('no fixture page made an external request', () => {
    assert.deepEqual(external, []);
  });
});

describe('mock planner (no browser)', () => {
  const aff = [
    { id: 'h1', kind: 'link', name: 'Certificate of Good Conduct', submit: false },
    { id: 'h2', kind: 'link', name: 'Birth Certificate', submit: false },
    { id: 'h3', kind: 'link', name: 'Marriage Certificate', submit: false },
    { id: 'h4', kind: 'button', name: 'Pay KSh 1,050', submit: true },
  ];
  test('v1 rules', () => {
    assert.deepEqual(mockPlan({ instruction: 'shuka chini' }), { action: 'scroll', direction: 'down' });
    assert.deepEqual(mockPlan({ instruction: 'go back' }), { action: 'go_back' });
    assert.deepEqual(mockPlan({ instruction: 'nisomee' }), { action: 'read_page' });
    assert.deepEqual(mockPlan({ instruction: 'search for KRA PIN' }), { action: 'search_web', query: 'KRA PIN' });
  });
  test('v2: one match clicks, several clarify, pay/transfer is none', () => {
    assert.deepEqual(mockPlan({ instruction: 'open birth', affordances: aff }), { action: 'click', target_id: 'h2' });
    const c = mockPlan({ instruction: 'the certificate one', affordances: aff });
    assert.equal(c.action, 'clarify');
    assert.deepEqual(c.options.map((o) => o.target_id), ['h1', 'h2', 'h3']);
    assert.equal(mockPlan({ instruction: 'pay now', affordances: aff }).action, 'none');
    assert.equal(mockPlan({ instruction: 'transfer all my money', affordances: aff }).action, 'none');
  });
});
