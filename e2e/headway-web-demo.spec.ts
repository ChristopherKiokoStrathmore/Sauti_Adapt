import { expect, test } from '@playwright/test';

test('the actual bundled Human.js ESM module initializes the Headway constructor', async ({ page }) => {
  await page.goto('/workspace');
  const result = await page.evaluate(async () => {
    return await new Promise<{ state: string; hasDetect: boolean; hasLoad: boolean }>((resolve) => {
      const timeout = window.setTimeout(() => resolve({ state: 'timeout', hasDetect: false, hasLoad: false }), 30_000);
      const ready = () => {
        clearTimeout(timeout);
        window.removeEventListener('headway-human-error', failed);
        const Constructor = (window as unknown as { __HeadwayHumanConstructor?: new (config: object) => { detect?: unknown; load?: unknown } }).__HeadwayHumanConstructor;
        const instance = Constructor ? new Constructor({ backend: 'webgl', face: { enabled: true } }) : null;
        resolve({ state: 'ready', hasDetect: typeof instance?.detect === 'function', hasLoad: typeof instance?.load === 'function' });
      };
      const failed = (event: Event) => {
        clearTimeout(timeout);
        window.removeEventListener('headway-human-ready', ready);
        resolve({ state: String((event as CustomEvent<string>).detail || 'failed'), hasDetect: false, hasLoad: false });
      };
      window.addEventListener('headway-human-ready', ready, { once: true });
      window.addEventListener('headway-human-error', failed, { once: true });
      const loader = document.createElement('script');
      loader.type = 'module';
      loader.src = '/headway-demo/loader.js';
      loader.onerror = () => failed(new CustomEvent('headway-human-error', { detail: 'script load failed' }));
      document.head.appendChild(loader);
    });
  });
  expect(result).toEqual({ state: 'ready', hasDetect: true, hasLoad: true });
});

test('Headway pointer appears immediately while the browser camera permission is pending', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: () => new Promise<MediaStream>(() => {
        // Keep permission unresolved: the pointer must not wait for the camera or model.
      }),
    });
  });
  await page.goto('/');
  await expect(page.locator('.hw-pointer')).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: /Enable Headway/ }).click();
  await expect(page.locator('.hw-pointer.hw-pointer-waiting')).toBeVisible();
  await expect(page.locator('.hw-pointer')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.hw-panel')).toContainText('Requesting camera permission');
  await page.locator('.hw-panel').getByRole('button', { name: 'Stop Headway', exact: true }).click();
  await expect(page.locator('.hw-pointer')).toHaveCount(0);
});

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
  await page.locator('.hw-panel').getByRole('button', { name: 'Stop Headway', exact: true }).click();
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
  // This existing test checks continuous pointer motion, which is now the alternate mode.
  await page.getByLabel('Navigation mode').selectOption('free');
  const startingX = await page.locator('.hw-pointer').evaluate(el => parseFloat((el as HTMLElement).style.left));
  // A head movement toward screen right should move the pointer right, not mirror it.
  await page.evaluate(() => { (window as unknown as { __HeadwayFixture: { x: number } }).__HeadwayFixture.x = 400; });
  await expect.poll(async () => page.locator('.hw-pointer').evaluate(el => parseFloat((el as HTMLElement).style.left))).toBeGreaterThan(startingX + 0.5);
  // Returning toward screen left should move the pointer left.
  await page.evaluate(() => { (window as unknown as { __HeadwayFixture: { x: number } }).__HeadwayFixture.x = 60; });
  await expect.poll(async () => page.locator('.hw-pointer').evaluate(el => parseFloat((el as HTMLElement).style.left))).toBeLessThan(startingX - 0.5);
  await page.getByRole('button', { name: 'Minimize' }).click();
  await expect(page.locator('.hw-panel')).toHaveClass(/hw-panel-collapsed/);
  await page.getByRole('link', { name: /Open accessible workspace/i }).first().click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator('.hw-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Stop Headway and release camera' }).click();
  expect(await page.evaluate(() => (window as unknown as { __HeadwayFixture: { stopped: number } }).__HeadwayFixture.stopped)).toBeGreaterThan(0);
  await expect(page.locator('.hw-pointer')).toHaveCount(0);
});

test('website bundles only local tracking assets and retains the unmodified extension entry point', async ({ request }) => {
  for (const path of ['/headway-demo/loader.js','/headway-demo/human.esm.js','/headway-demo/models/blazeface.json','/headway-demo/models/facemesh.json']) {
    const response = await request.get(path);
    expect(response.ok(), path + ' returned ' + response.status()).toBeTruthy();
  }
});


test('magnetic direction geometry chooses nearest forward control without jitter', async () => {
  const { headDirection, nextSnapIndex, closestSnapIndex } = await import('../apps/web/lib/headway-snap');
  const boxes = [
    { x: 250, y: 200, width: 100, height: 60 },
    { x: 430, y: 205, width: 100, height: 60 },
    { x: 245, y: 330, width: 100, height: 60 },
    { x: 55, y: 195, width: 100, height: 60 },
  ];
  expect(nextSnapIndex(boxes, 0, 'right')).toBe(1);
  expect(nextSnapIndex(boxes, 0, 'down')).toBe(2);
  expect(nextSnapIndex(boxes, 0, 'left')).toBe(3);
  expect(nextSnapIndex(boxes, 0, 'up')).toBe(-1);
  expect(closestSnapIndex(boxes, 600, 500)).toBe(0);
  expect(headDirection(0.12, 0, 1)).toBe('right');
  expect(headDirection(-0.12, 0, 1)).toBe('left');
  expect(headDirection(0, 0.12, 1)).toBe('down');
  expect(headDirection(0, -0.12, 1)).toBe('up');
  expect(headDirection(0.055, 0.01, 1)).toBeNull();
  expect(headDirection(0.01, 0.01, 1)).toBe('neutral');
});

test('magnetic Headway defaults to mouth selection, snaps with head motion, and avoids held-mouth repeats', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __SnapFixture: { x: number; y: number; mouth: number; clicks: number; stopped: number };
      __HeadwayHumanConstructor: new (args: object) => {
        load: () => Promise<void>; detect: () => Promise<unknown>;
      };
    };
    w.__SnapFixture = { x: 240, y: 150, mouth: 0.2, clicks: 0, stopped: 0 };
    class SyntheticFaceModel {
      async load() {}
      async detect() {
        const points = Array.from({ length: 468 }, () => [320, 240, 0]);
        points[13] = [320, 240, 0];
        points[14] = [320, 240 + 40 * w.__SnapFixture.mouth, 0];
        points[61] = [300, 240, 0];
        points[291] = [340, 240, 0];
        return { face: [{
          score: 0.95, box: [w.__SnapFixture.x, w.__SnapFixture.y, 180, 180],
          mesh: points, rotation: { angle: { yaw: 0, pitch: 0 } },
        }] };
      }
    }
    w.__HeadwayHumanConstructor = SyntheticFaceModel as unknown as typeof w.__HeadwayHumanConstructor;
    document.addEventListener('click', event => {
      const selected = document.querySelector('.hw-snap-target');
      if (selected?.contains(event.target as Node)) w.__SnapFixture.clicks++;
    }, true);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const timer = window.setInterval(() => { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 480); }, 100);
      const stream = canvas.captureStream(20);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { w.__SnapFixture.stopped++; window.clearInterval(timer); stop(); };
      }
      return stream;
    } });
  });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Enable Headway' }).click();
  await expect(page.getByLabel('Navigation mode')).toHaveValue('snap');
  await expect(page.getByLabel('Click method')).toHaveValue('mouth');
  await expect(page.locator('.hw-snap-target')).toHaveCount(1);
  await expect(page.locator('.hw-panel')).toContainText('Mouth ready.');
  const initialTarget = await page.locator('.hw-snap-target').evaluate(el => el.outerHTML);
  await page.evaluate(() => { (window as unknown as { __SnapFixture: { x: number } }).__SnapFixture.x = 480; });
  await expect.poll(async () => page.locator('.hw-snap-target').evaluate(el => el.outerHTML)).not.toEqual(initialTarget);
  const jumped = await page.locator('.hw-snap-target').evaluate(el => el.outerHTML);
  // Holding the head right must not repeatedly cycle through controls.
  await page.waitForTimeout(550);
  await expect(page.locator('.hw-snap-target')).toHaveJSProperty('outerHTML', jumped);
  const startClicks = await page.evaluate(() => (window as unknown as { __SnapFixture: { clicks: number } }).__SnapFixture.clicks);
  await page.evaluate(() => { (window as unknown as { __SnapFixture: { mouth: number } }).__SnapFixture.mouth = 0.48; });
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __SnapFixture: { clicks: number } }).__SnapFixture.clicks)).toBe(startClicks + 1);
  await page.waitForTimeout(850);
  expect(await page.evaluate(() => (window as unknown as { __SnapFixture: { clicks: number } }).__SnapFixture.clicks)).toBe(startClicks + 1);
  await page.evaluate(() => { (window as unknown as { __SnapFixture: { mouth: number } }).__SnapFixture.mouth = 0.2; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as unknown as { __SnapFixture: { mouth: number } }).__SnapFixture.mouth = 0.48; });
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __SnapFixture: { clicks: number } }).__SnapFixture.clicks)).toBe(startClicks + 2);
  await page.getByRole('button', { name: 'Stop Headway', exact: true }).click();
  await expect(page.locator('.hw-snap-target')).toHaveCount(0);
});
