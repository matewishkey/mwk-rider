#!/usr/bin/env node
/**
 * Visual diagnostic — screenshots key search-box states.
 * Outputs to ./screenshots/<timestamp>/
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const base = process.argv[2] || 'http://localhost:23004';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(process.cwd(), 'screenshots', stamp);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

async function shot(name) {
  const p = join(outDir, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('  →', p);
}

console.log(`Output: ${outDir}\n`);

// 1. Fresh home — what facets/UI looks like right out of the gate
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
await shot('01-home-fresh');

// 2. After typing
await page.fill('#search-input', 'deploy');
await page.waitForFunction(() => document.querySelector('#search-status')?.textContent?.includes('"deploy"'), { timeout: 5000 }).catch(() => {});
await shot('02-home-after-typing');

// 3. After applying a type filter
await page.locator('#search-facets .group').first().locator('.chip').first().click();
await page.waitForFunction(() => /filtered/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
await shot('03-home-with-filter');

// 4. Multi-facet — also click first tag
await page.locator('#search-facets .group').nth(1).locator('.chip').first().click();
await page.waitForTimeout(500);
await shot('04-home-multi-facet');

// 5. Focused state of the input
await page.fill('#search-input', '');
await page.locator('#search-input').focus();
await page.waitForTimeout(300);
await shot('05-input-focused-empty');

// 6. Mobile viewport — same fresh state
await page.setViewportSize({ width: 414, height: 900 });
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
await shot('06-mobile-fresh');

await browser.close();
console.log(`\nDone — ${stamp}`);
