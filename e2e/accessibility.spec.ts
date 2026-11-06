import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

async function axeViolations(page: Page) {
  // Use the already pinned toolkit copy. Never load a remote script in tests.
  await page.addScriptTag({ path: join(process.cwd(), 'vendor/ai4a11y-toolkit/cli/axe-core.min.js') });
  return page.evaluate(async () => {
    const tool = (window as unknown as {
      axe: { run: (node: Element, options: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }> }
    }).axe;
    const output = await tool.run(document.documentElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return output.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length }));
  });
}

test('onboarding exposes no serious or critical axe issues', async ({ page }, testInfo) => {
  await page.goto('/');
  const issues = await axeViolations(page);
  await testInfo.attach('axe-onboarding.json', {
    body: JSON.stringify(issues, null, 2),
    contentType: 'application/json',
  });
  expect(issues.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
});

test('workspace exposes no serious or critical axe issues', async ({ page }, testInfo) => {
  await page.goto('/workspace');
  const issues = await axeViolations(page);
  await testInfo.attach('axe-workspace.json', {
    body: JSON.stringify(issues, null, 2),
    contentType: 'application/json',
  });
  expect(issues.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
});

test('keyboard focus enters interactive onboarding controls', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    visible: document.activeElement instanceof HTMLElement &&
      getComputedStyle(document.activeElement).visibility !== 'hidden',
  }));
  expect(['BUTTON', 'A', 'INPUT']).toContain(focus.tag);
  expect(focus.visible).toBe(true);
});

test('the main onboarding action is at least 44 CSS pixels tall', async ({ page }) => {
  await page.goto('/');
  const action = page.getByRole('button', { name: /Get started/ }).first();
  const rect = await action.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.height).toBeGreaterThanOrEqual(44);
});
