import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const origin = process.env.TEST_UI_ORIGIN || 'https://captainhook.fun';
const localServer = process.env.START_LOCAL_UI === '1' ? spawn(process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-p', '3000'], { stdio: 'ignore' }) : null;
if (localServer) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* wait for server */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
const failed = [];
const consoleErrors = [];
page.on('pageerror', (error) => errors.push(error.stack || error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('requestfailed', (request) => failed.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#captain-market').waitFor({ timeout: 60000 });
  await page.locator('#captain-swap').locator('input').first().waitFor({ timeout: 60000 });
  assert.equal(await page.locator('#captain-market').inputValue(), 'XEEu6i2pqjsZn63spYuyDCd5yizaE1pJ7iPbNPW1oMo');
  await page.screenshot({ path: new URL('../test-results/captain-desktop.png', import.meta.url).pathname, fullPage: true });
  const values = await page.locator('#captain-market option').evaluateAll((options) => options.map((option) => option.value));
  for (const mint of values.slice(0, 3)) {
    await page.locator('#captain-market').selectOption(mint);
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(await page.getByRole('button', { name: 'Sell', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await page.getByRole('button', { name: 'Hook auctions', exact: true }).click();
    await page.getByRole('heading', { name: 'Set the next hook.' }).waitFor();
    await page.getByRole('button', { name: 'Trade', exact: true }).click();
  }
  for (const width of [840, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    assert.equal(overflow, false, `Page overflows at ${width}px`);
    await page.screenshot({ path: new URL(`../test-results/captain-${width}.png`, import.meta.url).pathname, fullPage: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ rendered: true, defaultMint: 'XEEu', selectableHookedMints: 3,
    buySellControls: 'passed', liveAuctionControls: 'passed', responsiveWidths: [1440, 840, 390], pageErrors: errors }));
} catch (error) {
  await page.screenshot({ path: new URL('../test-results/captain-error.png', import.meta.url).pathname, fullPage: true });
  console.log(JSON.stringify({ errors, failed, consoleErrors, visibleText: await page.locator('body').innerText() }));
  throw error;
} finally { await browser.close(); localServer?.kill('SIGTERM'); }
