import { expect, test } from '@playwright/test';
import { places, profiles, scenarios } from '../../shared/catalog';

for (const available of [true, false]) {
  test(`station shows ${available ? 'current and forecast crowd icons' : 'unavailable crowd icons without inventing levels'}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('wlt-onboarding-v1', 'true'));
    await page.route('**/api/config', route => route.fulfill({ json: { places, profiles, scenarios, dataMode: 'live', integrations: { lta: false, vertex: false, tts: false, push: false, googleAccounts: false, googlePlaces: false }, googlePlacesApiKey: null, googleClientId: null, vapidPublicKey: null } }));
    await page.route('https://www.onemap.gov.sg/maps/tiles/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
    await page.route('**/api/transit-stops', route => route.fulfill({ json: [{ id: 'fixture', mode: 'rail', name: 'Test Station', codes: ['EW2'], lines: ['EWL'], lat: 1.345, lon: 103.882 }] }));
    await page.route('**/api/station-board?*', route => route.fulfill({ json: {
      groups: [], crowds: [{ line: 'EWL', level: available ? 'moderate' : 'unknown', status: available ? 'current station crowd' : 'stale' }],
      forecasts: available ? ['low', 'moderate', 'high'].map((level, i) => ({ line: 'EWL', level, status: 'forecast', start: new Date(Date.now() + i * 1800000).toISOString(), end: new Date(Date.now() + (i + 1) * 1800000).toISOString() })) : [{ line: 'EWL', level: 'unknown', status: 'unavailable' }],
    } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Test Station MRT / LRT station', exact: true }).click();
    await page.getByRole('button', { name: 'Show Test Station station information' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test Station information' });
    await expect(dialog.getByRole('heading', { name: 'Current crowdedness' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Predicted crowdedness' })).toBeVisible();
    if (available) {
      await expect(dialog.getByRole('img', { name: 'Moderate crowdedness' })).toHaveCount(2);
      await expect(dialog.getByRole('img', { name: 'Low crowdedness' }).locator('.filled')).toHaveCount(1);
      await expect(dialog.getByRole('img', { name: 'High crowdedness' }).locator('.filled')).toHaveCount(3);
      await expect(dialog.locator('.station-crowd-card').filter({ hasText: 'Forecast ·' })).toHaveCount(3);
    } else {
      await expect(dialog.getByRole('img', { name: 'Unavailable crowdedness' })).toHaveCount(2);
      await expect(dialog.locator('.filled')).toHaveCount(0);
      await expect(dialog).toContainText('stale');
    }
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Close station or stop information' }).click();
    await expect(dialog).toHaveCount(0);
  });
}
