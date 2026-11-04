import { expect, test, type Page } from '@playwright/test';
import { API_URL, USER_ID, USER_TOKEN } from './env';

/** One second of a 440 Hz tone. Not a person's voice. */
function sineWav(): Buffer {
  const sampleRate = 16000;
  const samples = sampleRate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  return data;
}

async function clientSource(page: Page): Promise<string> {
  const srcs = await page.locator('script[src]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLScriptElement).src).filter(Boolean));
  const chunks: string[] = [];
  for (const src of srcs) {
    const response = await page.request.get(src);
    if (response.ok()) chunks.push(await response.text());
  }
  return chunks.join('\n');
}

async function fontScale(page: Page): Promise<string> {
  return page.locator('#controlled-site').evaluate((element) => element.style.getPropertyValue('--aa-font-scale'));
}

async function openRecognitionCheck(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Onboarding steps' }).getByRole('button', { name: /Check recognition/i }).click();
}

async function prepareRecognition(page: Page): Promise<void> {
  await page.locator('#listen').selectOption('separate');
  await page.getByRole('navigation', { name: 'Onboarding steps' }).getByRole('button', { name: /Your permission/i }).click();
  await page.locator('#user').fill(USER_ID);
  await page.locator('#code').fill(USER_TOKEN);
  await openRecognitionCheck(page);
}

test('a foreign browser origin cannot call the speech proxy', async ({ request }) => {
  const response = await request.post('/api/recognize', {
    headers: { origin: 'https://evil.example', 'x-sauti-user': USER_ID, 'x-sauti-user-token': USER_TOKEN },
    multipart: {
      audio: { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav() },
      profile_id: '11111111-1111-4111-8111-111111111111',
      language: 'en-KE',
    },
  });
  expect(response.status()).toBe(403);
});

test('the page bundles the pinned upstream Controller and not the stock speech widget', async ({ page }) => {
  await page.goto('/');
  const css = await page.locator('style[data-aa-upstream-css]').textContent();
  expect(css).toContain('[style*="--aa-font-scale"]');
  expect(css).toContain('.aa-dark { filter: invert(1) hue-rotate(180deg)');
  await expect(page.locator('.aa-controller')).toHaveCount(0);
  const source = await clientSource(page);
  // These literals are in the pinned 7cf5006 controller sources. A substitute
  // createController that is not that module does not carry them.
  expect(source).toContain('Say yes to confirm');
  expect(source).toContain('Making text bigger');
  expect(source).toContain('--aa-font-scale');
});

test('bigger text and undo use upstream handle() and the upstream style variable', async ({ page }) => {
  await page.goto('/');
  await openRecognitionCheck(page);
  const site = page.locator('#controlled-site');
  const before = await site.evaluate((element) => getComputedStyle(element).fontSize);
  await expect(fontScale(page)).resolves.toBe('');

  await page.getByRole('button', { name: 'bigger text' }).click();
  await expect(page.getByRole('status')).toHaveText('Making text bigger.');
  await expect.poll(() => fontScale(page)).toBe('1.1');
  const larger = await site.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(larger).toBeGreaterThan(Number.parseFloat(before));

  await page.getByRole('button', { name: 'bigger text' }).click();
  await expect.poll(() => fontScale(page)).toBe('1.2');

  await page.getByRole('button', { name: 'Undo last setting' }).click();
  await expect(page.getByRole('status')).toHaveText('Undone.');
  await expect.poll(() => fontScale(page)).toBe('1.1');
});

test('scroll down moves the article through the real receiver', async ({ page }) => {
  await page.goto('/');
  await openRecognitionCheck(page);
  const site = page.locator('#controlled-site');
  const before = await site.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: 'scroll down', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Scrolling down.');
  await expect.poll(() => site.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
});

test('mock-mode audio is rejected and does not move the demo DOM', async ({ page, request }) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({ status: 'ok', mode: 'mock' });

  await page.goto('/');
  await expect.poll(() => page.locator('#profile').inputValue()).not.toBe('');
  const profile = await page.locator('#profile').inputValue();
  const site = page.locator('#controlled-site');
  const before = {
    scroll: await site.evaluate((element) => element.scrollTop),
    scale: await fontScale(page),
    status: await page.getByRole('status').innerText(),
  };

  const result = await page.evaluate(async ({ user, token, profileId, wav }) => {
    const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'tone.wav');
    form.append('profile_id', profileId);
    form.append('language', 'en-KE');
    const response = await fetch('/api/recognize', {
      method: 'POST',
      body: form,
      headers: { 'x-sauti-user': user, 'x-sauti-user-token': token },
    });
    return { http: response.status, body: await response.json() };
  }, { user: USER_ID, token: USER_TOKEN, profileId: profile, wav: sineWav().toString('base64') });

  expect(result.http).toBe(200);
  expect(result.body.status).toBe('rejected');
  expect(result.body.intent).toBe('UNKNOWN');
  expect(String(result.body.reason)).toContain('MODEL_NOT_READY');
  expect(await site.evaluate((element) => element.scrollTop)).toBe(before.scroll);
  expect(await fontScale(page)).toBe(before.scale);
  expect(await page.getByRole('status').innerText()).toBe(before.status);
});

test('read aloud and outline skip hidden headings in Chromium', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('#profile').inputValue()).not.toBe('');
  await openRecognitionCheck(page);
  await page.locator('#controlled-site').evaluate(element => {
    element.insertAdjacentHTML('afterbegin', `
      <h2 style="display:none">SECRET-DISPLAY</h2>
      <h2 style="visibility:hidden">SECRET-VISIBILITY</h2>
      <h2 hidden>SECRET-HIDDEN-ATTR</h2>
      <h2 aria-hidden="true">SECRET-ARIA</h2>
      <h1>Visible title<span style="display:none">SECRET-NESTED</span></h1>
      <p>Visible sentence</p>`);
  });
  const secrets = ['SECRET-DISPLAY', 'SECRET-VISIBILITY', 'SECRET-HIDDEN-ATTR', 'SECRET-ARIA', 'SECRET-NESTED'];
  await page.getByRole('button', { name: "What's on screen" }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Visible title');
  for (const secret of secrets) await expect(status).not.toContainText(secret);
  await page.getByRole('button', { name: 'Read this page aloud' }).click();
  await expect(status).toContainText('Visible sentence');
  for (const secret of secrets) await expect(status).not.toContainText(secret);
});

test('read this is spoken and a rejected recognition is silent', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('#profile').inputValue()).not.toBe('');
  await prepareRecognition(page);
  await page.evaluate(() => {
    const slot = window as Window & { __spoken: string[] };
    slot.__spoken = [];
    window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => { slot.__spoken.push(utterance.text); };
  });
  await page.getByRole('button', { name: 'Read this page aloud' }).click();
  await expect.poll(() => page.evaluate(() => ((window as Window & { __spoken?: string[] }).__spoken || []).join('\n'))).toContain('Welcome to the accessible demo');
  await holdRecognition(page, { status: 'rejected', intent: 'UNKNOWN', language: null, confidence: 0.2, model_version: 'fixture', reason: 'UNCERTAIN_OR_UNKNOWN' });
  await page.getByRole('button', { name: 'Start voice recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop and process voice' })).toBeEnabled();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop and process voice' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __release?: () => void }).__release))).toBeTruthy();
  await page.evaluate(() => (window as Window & { __release?: () => void }).__release?.());
  await expect(page.getByRole('status')).toContainText('Nothing was spoken');
  const spoken = await page.evaluate(() => (window as Window & { __spoken?: string[] }).__spoken || []);
  expect(spoken.some((line) => line.includes('Welcome'))).toBeTruthy();
  expect(spoken.filter((line) => !line.includes('Welcome'))).toEqual([]);
});

test('a route change or cleared token during recognition runs no command', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('#profile').inputValue()).not.toBe('');
  await prepareRecognition(page);
  const site = page.locator('#controlled-site');
  const before = await site.evaluate((element) => element.scrollTop);
  await holdRecognition(page, { status: 'accepted', intent: 'SCROLL_DOWN', language: 'en-KE', confidence: 0.9, model_version: 'fixture', reason: null });
  await page.getByRole('button', { name: 'Start voice recording' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop and process voice' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __release?: () => void }).__release))).toBeTruthy();
  await page.evaluate(() => history.pushState({}, '', '/moved'));
  await page.evaluate(() => (window as Window & { __release?: () => void }).__release?.());
  await expect(page.getByRole('status')).toContainText('page changed');
  expect(await site.evaluate((element) => element.scrollTop)).toBe(before);

  await page.goto('/');
  await expect.poll(() => page.locator('#profile').inputValue()).not.toBe('');
  await prepareRecognition(page);
  await holdRecognition(page, { status: 'accepted', intent: 'SCROLL_DOWN', language: 'en-KE', confidence: 0.9, model_version: 'fixture', reason: null });
  await page.getByRole('button', { name: 'Start voice recording' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop and process voice' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __release?: () => void }).__release))).toBeTruthy();
  await page.locator('#code').fill('');
  await page.evaluate(() => (window as Window & { __release?: () => void }).__release?.());
  await expect(page.getByRole('status')).toContainText('Sign-in changed');
  expect(await site.evaluate((element) => element.scrollTop)).toBe(0);
});

async function holdRecognition(page: Page, payload: object) {
  await page.evaluate(async (body) => {
    const slot = window as Window & { __release?: () => void };
    const audio = new AudioContext();
    await audio.resume();
    const dest = audio.createMediaStreamDestination();
    const tone = audio.createOscillator();
    tone.connect(dest);
    tone.start();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/api/recognize')) return original(input, init);
      return new Promise(resolve => {
        slot.__release = () => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
      });
    };
  }, payload);
}

test('read this page speaks the on-screen article with speechSynthesis', async ({ page }) => {
  await page.goto('/');
  await openRecognitionCheck(page);
  const available = await page.evaluate(() => typeof window.speechSynthesis?.speak === 'function');
  test.skip(!available, 'speechSynthesis is not available in this browser');
  await page.evaluate(() => {
    const spoken: { text: string; lang: string }[] = [];
    (window as Window & { __sautiSpoken?: { text: string; lang: string }[] }).__sautiSpoken = spoken;
    const original = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
      spoken.push({ text: utterance.text, lang: utterance.lang });
      try { return original(utterance); } catch { /* The call itself is the observation. */ }
    };
  });
  await page.getByRole('button', { name: 'Read this page aloud' }).click();
  await page.waitForFunction(() => {
    const spoken = (window as Window & { __sautiSpoken?: { text: string; lang: string }[] }).__sautiSpoken ?? [];
    return spoken.some((item) => item.text.includes('Welcome to the accessible demo'));
  });
  const spoken = await page.evaluate(() => (window as Window & { __sautiSpoken?: { text: string; lang: string }[] }).__sautiSpoken ?? []);
  expect(spoken.some((item) => item.lang === 'en-KE' && item.text.includes('Welcome to the accessible demo'))).toBeTruthy();
  await expect(page.getByRole('status')).toContainText('Welcome to the accessible demo');
});

