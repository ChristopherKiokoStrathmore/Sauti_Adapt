import { expect, test } from '@playwright/test';

test('Headway is the extension offered after onboarding, without requiring speech recognition', async ({ page }) => {
  await page.goto('/');
  const install = page.getByRole('link', { name: 'Install browser extension' });
  await expect(install).toHaveAttribute('href', '/install');
  await install.click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole('heading', { name: 'Meet Headway.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready in four steps' })).toBeVisible();
  const download = page.getByRole('link', { name: 'Download Headway Chrome extension ZIP' });
  await expect(download).toHaveAttribute(
    'href',
    'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/download/headway-hackathon/Headway-Chrome-Hackathon.zip',
  );
  await expect(page.getByText('chrome://extensions', { exact: true })).toBeVisible();
  await expect(page.getByText('Load unpacked', { exact: true })).toBeVisible();
  await expect(page.getByText('debugger permission', { exact: false })).toBeVisible();
});

test('Headway installation instructions are usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/install');
  const sizes = await page.evaluate(() => {
    const button = document.querySelector('.install-primary')!.getBoundingClientRect();
    return { documentWidth: document.documentElement.scrollWidth, innerWidth, buttonHeight: button.height };
  });
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.innerWidth + 1);
  expect(sizes.buttonHeight).toBeGreaterThanOrEqual(54);
  await expect(page.getByRole('link', { name: /Return to voice onboarding/ })).toHaveAttribute('href', '/');
});
