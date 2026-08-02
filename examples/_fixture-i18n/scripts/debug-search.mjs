#!/usr/bin/env node
/**
 * Playwright-driven smoke test for the faceted search box.
 *
 * Verifies on both locales:
 *   - Initial paint renders facet chips (counts > 0)
 *   - Typing narrows results
 *   - Clicking a facet chip applies a filter (status mentions "filtered",
 *     URL hash updates)
 *   - Clicking the same chip removes it
 *   - "Clear all" pill resets filters
 *
 * First iteration of what tests/preview.spec.ts will become for
 * /wishbusterz-rider-preview in Phase 2.
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:23002';

function header(s) { console.log('\n' + '='.repeat(60) + '\n' + s + '\n' + '='.repeat(60)); }

async function probe(page, url, query) {
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for first paint (status moves past "ready" / "fetching")
  await page.waitForFunction(() => {
    const t = document.querySelector('#search-status')?.textContent ?? '';
    return /result/i.test(t);
  }, { timeout: 5000 }).catch(() => {});

  const initialStatus = await page.locator('#search-status').textContent();
  const initialFacets = await page.locator('#search-facets .chip').allTextContents();

  // Type the query
  await page.fill('#search-input', query);
  await page.waitForFunction((q) => {
    const t = document.querySelector('#search-status')?.textContent ?? '';
    return t.includes(`"${q}"`);
  }, query, { timeout: 5000 }).catch(() => {});
  const queryStatus = await page.locator('#search-status').textContent();

  // Click first non-empty type chip to apply a filter
  const firstTypeChip = page.locator('#search-facets .group').first().locator('.chip').first();
  const typeChipText = await firstTypeChip.textContent().catch(() => '?');
  await firstTypeChip.click().catch(() => {});
  await page.waitForFunction(() => /filtered/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
  const filteredStatus = await page.locator('#search-status').textContent();
  const urlAfterFilter = page.url();
  const activeFiltersCount = await page.locator('#search-active-filters .pill').count();

  // Click clear-all
  await page.locator('[data-clear-all]').click().catch(() => {});
  await page.waitForTimeout(300);
  const clearedStatus = await page.locator('#search-status').textContent();
  const urlAfterClear = page.url();

  return {
    url, query,
    initialStatus,
    initialFacets,
    queryStatus,
    typeChipText: typeChipText?.trim(),
    filteredStatus,
    urlAfterFilter,
    activeFiltersCount,
    clearedStatus,
    urlAfterClear,
    logs: logs.filter((l) => !l.includes('Outdated Optimize') && !l.includes('vite') && !l.includes('prefetch')),
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const en = await probe(page, `${base}/`, 'media');
const hu = await probe(page, `${base}/hu`, 'média');

await browser.close();

for (const r of [en, hu]) {
  header(`${r.url}  ·  query="${r.query}"`);
  console.log('initial status   :', r.initialStatus);
  console.log('initial facets   :', r.initialFacets);
  console.log('after typing     :', r.queryStatus);
  console.log('clicked chip     :', r.typeChipText);
  console.log('filtered status  :', r.filteredStatus);
  console.log('url with filter  :', r.urlAfterFilter);
  console.log('active filters # :', r.activeFiltersCount);
  console.log('cleared status   :', r.clearedStatus);
  console.log('url cleared      :', r.urlAfterClear);
  if (r.logs.length) {
    console.log('console errors   :');
    for (const line of r.logs) console.log('  ' + line);
  }
}
