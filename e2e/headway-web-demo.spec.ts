import { expect, test } from '@playwright/test';

test('Headway requests no camera permission before the user activates it', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cameraRequests: number }).__cameraRequests = 0;
    const media = navigator.mediaDevices;
    Object.defineProperty(media, 'getUserMedia', {
      configurable: true,
      value: async () => {
        (window as unknown as { __cameraRequests: number }).__cameraRequests++;
        throw new DOMException('Permission denied for this test', 'NotAllowedError');
      },
    });
  });
  await page.goto('/');
  expect(await page.evaluate(() => (window as unknown as { __cameraRequests: number }).__cameraRequests)).toBe(0);
  await page.locator('.topbar').getByRole('button', { name: /Enable Headway/ }).click();
  await expect(page.locator('.hw-panel')).toContainText('Permission denied for this test');
  expect(await page.evaluate(() => (window as unknown as { __cameraRequests: number }).__cameraRequests)).toBe(1);
  await page.getByRole('button', { name: 'Stop Headway' }).click();
  await expect(page.locator('.hw-panel')).toHaveCount(0);
});

test('Headway practice workspace offers safe interactive experiences without an extension', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Explore your way.' })).toBeVisible();
  await expect(page.locator('.aw-status')).toContainText('Headway off');
  await page.getByRole('button', { name: 'Larger text' }).click();
  await expect(page.locator('.aw-article')).toHaveClass(/aw-large/);
  await page.getByRole('button', { name: 'High contrast' }).click();
  await expect(page.locator('.aw-shell')).toHaveClass(/aw-contrast/);
  await page.getByRole('button', { name: 'Shopping practice' }).click();
  await page.getByRole('button', { name: 'Add to practice basket' }).first().click();
  await expect(page.getByText('Practice basket: 1 items')).toBeVisible();
  await page.getByRole('button', { name: 'Form practice' }).click();
  await page.locator('#aw-name').fill('Test participant');
  await page.getByRole('button', { name: 'Submit practice form' }).click();
  await expect(page.getByText('Practice submitted. Selected language: English.', { exact: false })).toBeVisible();
  await expect(page.locator('a[href$=".zip"]')).toHaveCount(0);
});

test('Headway mock camera fixture confirms global session survives Sauti client navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __HeadwayHumanConstructor: new (c: unknown) => { load: () => Promise<void>; detect: () => Promise<unknown> };
      __HeadwayFixture?: { x: number; stopped: number };
    };
    w.__HeadwayFixture = { x: 240, stopped: 0 };
    class FixtureHuman {
      async load() {}
      async detect() {
        const mesh = Array.from({ length: 468 }, () => [320, 240, 0]);
        mesh[13] = [320, 238, 0]; mesh[14] = [320, 246, 0];
        mesh[61] = [300, 240, 0]; mesh[291] = [340, 240, 0];
        return { face: [{ score: 0.95, box: [w.__HeadwayFixture!.x, 150, 180, 180], mesh, rotation: { angle: { yaw: 0, pitch: 0 } } }] };
      }
    }
    w.__HeadwayHumanConstructor = FixtureHuman as unknown as typeof w.__HeadwayHumanConstructor;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(20);
      const timer = window.setInterval(() => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); }, 150);
      stream.getTracks().forEach(track => track.addEventListener('ended', () => clearInterval(timer), { once: true }));
      for (const track of stream.getTracks()) {
        const original = track.stop.bind(track);
        track.stop = () => { w.__HeadwayFixture!.stopped++; original(); };
      }
      return stream;
    } });
  });
  await page.goto('/');
  await page.locator('.topbar').getByRole('button', { name: /Enable Headway/ }).click();
  await expect(page.getByText('Face detected. Headway is tracking locally.')).toBeVisible();
  const startingX = await page.locator('.hw-pointer').evaluate(el => parseFloat((el as HTMLElement).style.left));
  await page.evaluate(() => { (window as unknown as { __HeadwayFixture: { x: number } }).__HeadwayFixture.x = 60; });
  await expect.poll(async () => page.locator('.hw-pointer').evaluate(el => parseFloat((el as HTMLElement).style.left))).not.toBe(startingX);
  await page.getByRole('button', { name: 'Minimize' }).click();
  await expect(page.locator('.hw-panel')).toHaveClass(/hw-panel-collapsed/);
  await page.getByRole('link', { name: /Open accessible workspace/i }).first().click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator('.hw-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Stop Headway' }).click();
  expect(await page.evaluate(() => (window as unknown as { __HeadwayFixture: { stopped: number } }).__HeadwayFixture.stopped)).toBeGreaterThan(0);
  await expect(page.locator('.hw-pointer')).toHaveCount(0);
});

test('website bundles only local tracking assets and retains the unmodified extension entry point', async ({ request }) => {
  for (const path of ['/headway-demo/loader.js','/headway-demo/human.esm.js','/headway-demo/models/blazeface.json','/headway-demo/models/facemesh.json']) {
    const response = await request.get(path);
    expect(response.ok(), path + ' returned ' + response.status()).toBeTruthy();
  }
});
