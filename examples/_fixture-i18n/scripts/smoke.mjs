#!/usr/bin/env node
/**
 * Playwright smoke test for _fixture-i18n.
 *
 * Validates the full multi-locale stack: routes, SEO surface, search,
 * faceting, locale boundaries, hash state, translation switcher. First
 * iteration of what tests/preview.spec.ts becomes for /wishbusterz-rider-preview
 * in Phase 2.
 *
 * Usage:  node scripts/smoke.mjs [base-url]
 * Output: clear pass/fail per check, summary count at end.
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4321';
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const mark = pass ? '✅' : '❌';
  const tail = detail ? `  · ${detail}` : '';
  console.log(`${mark} ${name}${tail}`);
}

// ---------- Route crawl (HTTP smoke) ----------
async function httpSmoke() {
  console.log('\n── Routes (HTTP) ──');
  const routes = [
    ['/', 200, 'EN home'],
    ['/hu', 200, 'HU home'],
    ['/blog', 200, 'EN blog index'],
    ['/hu/blog', 200, 'HU blog index'],
    ['/blog/welcome', 200, 'EN paired post'],
    ['/hu/blog/welcome', 200, 'HU paired post'],
    ['/blog/standalone', 200, 'EN-only post'],
    ['/hu/blog/csak-magyar', 200, 'HU-only post'],
    ['/preview', 200, 'preview shelf'],
    ['/preview/og', 200, 'preview OG grid'],
    ['/preview/og/en/welcome', 200, 'OG template EN'],
    ['/preview/og/hu/welcome', 200, 'OG template HU'],
    ['/preview/og/list.json', 200, 'OG list endpoint'],
    ['/preview/posts/_preview-thoughts', 200, 'preview thoughts'],
    ['/preview/posts/_preview-project', 200, 'preview project'],
    ['/search-index-en.json', 200, 'EN search index'],
    ['/search-index-hu.json', 200, 'HU search index'],
    ['/rss-en.xml', 200, 'EN RSS'],
    ['/rss-hu.xml', 200, 'HU RSS'],
    ['/llms.txt', 200, 'root llms.txt'],
    ['/llms-en.txt', 200, 'EN llms.txt'],
    ['/llms-hu.txt', 200, 'HU llms.txt'],
    ['/favicon.svg', 200, 'favicon'],
    ['/404', 404, '404 page'],
  ];
  for (const [path, expected, label] of routes) {
    const r = await fetch(`${base}${path}`);
    record(`${label} → ${path}`, r.status === expected, `got ${r.status}, expected ${expected}`);
  }
}

// ---------- SEO surface (view-source assertions) ----------
async function seoSurface() {
  console.log('\n── SEO surface (/blog/welcome) ──');
  const html = await (await fetch(`${base}/blog/welcome`)).text();

  const checks = [
    ['title tag', /<title>Welcome to the i18n fixture · wishbusterz-rider i18n fixture<\/title>/],
    ['meta description', /<meta name="description"/],
    ['canonical link', /<link rel="canonical" href="[^"]+\/blog\/welcome"/],
    ['hreflang en-US', /<link rel="alternate" hreflang="en-US"/],
    ['hreflang hu-HU', /<link rel="alternate" hreflang="hu-HU"/],
    ['hreflang x-default', /<link rel="alternate" hreflang="x-default"/],
    ['og:title', /<meta property="og:title"/],
    ['og:image with dimensions', /<meta property="og:image:width" content="1200"/],
    ['og:locale', /<meta property="og:locale" content="en_US"/],
    ['twitter card', /<meta name="twitter:card" content="summary_large_image"/],
    ['article:published_time', /<meta property="article:published_time"/],
    ['article:tag (multiple)', /<meta property="article:tag" content="meta"/],
    ['BlogPosting JSON-LD', /"@type":"BlogPosting"/],
    ['inLanguage in JSON-LD', /"inLanguage":"en-US"/],
    ['BreadcrumbList JSON-LD', /"@type":"BreadcrumbList"/],
    ['favicon link', /<link rel="icon"/],
    ['theme-color', /<meta name="theme-color"/],
    ['RSS alternate (en)', /<link rel="alternate" type="application\/rss\+xml" title="RSS · English"/],
    ['llms.txt alternate', /<link rel="alternate" type="text\/plain" title="llms\.txt"/],
  ];
  for (const [name, re] of checks) {
    record(`SEO · ${name}`, re.test(html));
  }
}

// ---------- Locale-only post negative SEO check ----------
async function localeOnlySeo() {
  console.log('\n── Locale-only post (/blog/standalone) ──');
  const html = await (await fetch(`${base}/blog/standalone`)).text();
  // standalone has no translationKey → per current Google guidance, NO hreflang
  // block at all (omit, don't self-reference). The earlier-version of this test
  // looked for hu-HU anywhere in the response and picked up the post's own body
  // (which describes the test in a <code> block). Scope to head's link tags.
  const head = html.split('</head>')[0];
  const huAltInHead = /<link[^>]+rel="alternate"[^>]+hreflang="hu-HU"/.test(head);
  record('no hu-HU alternate in <head>', !huAltInHead);
  // Per best practice: no x-default either (only emitted when alternates exist).
  const xDefaultInHead = /<link[^>]+rel="alternate"[^>]+hreflang="x-default"/.test(head);
  record('no x-default in <head> (single-locale)', !xDefaultInHead);
}

// ---------- llms.txt content shape ----------
async function llmsTxt() {
  console.log('\n── llms.txt shape ──');
  const root = await (await fetch(`${base}/llms.txt`)).text();
  const enLocale = await (await fetch(`${base}/llms-en.txt`)).text();
  const huLocale = await (await fetch(`${base}/llms-hu.txt`)).text();
  record('root /llms.txt has H1', /^# /m.test(root));
  record('root /llms.txt links to per-locale', /llms-en\.txt/.test(root) && /llms-hu\.txt/.test(root));
  record('en /llms-en.txt has Thoughts section', /## Thoughts/.test(enLocale));
  record('en /llms-en.txt has Project section', /## Project/.test(enLocale));
  record('hu /llms-hu.txt has only HU posts', !enLocale.includes('Csak magyarul') && huLocale.includes('Csak magyarul'));
}

// ---------- RSS feeds ----------
async function rssCheck() {
  console.log('\n── RSS feeds ──');
  const en = await (await fetch(`${base}/rss-en.xml`)).text();
  const hu = await (await fetch(`${base}/rss-hu.xml`)).text();
  record('en RSS has language en-US', /<language>en-US<\/language>/.test(en));
  record('hu RSS has language hu-HU', /<language>hu-HU<\/language>/.test(hu));
  record('en RSS has no HU post', !en.includes('Csak magyarul'));
  record('hu RSS includes HU-only post', hu.includes('Csak magyarul'));
}

// ---------- Search + faceting (browser, via Playwright) ----------
async function searchFlow(page, locale) {
  console.log(`\n── Search + faceting (locale=${locale}) ──`);
  const url = locale === 'en' ? `${base}/` : `${base}/${locale}`;
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});

  // 1. Initial paint renders facets
  const initialChips = await page.locator('#search-facets .chip').count();
  record(`${locale} · initial facets render`, initialChips > 0, `${initialChips} chips`);

  // 2. Typing narrows results
  const term = locale === 'en' ? 'deploy' : 'telepítés';
  await page.fill('#search-input', term);
  await page.waitForFunction((t) => document.querySelector('#search-status')?.textContent?.includes(`"${t}"`), term, { timeout: 5000 }).catch(() => {});
  const queryStatus = await page.locator('#search-status').textContent();
  const queryMatched = /^[1-9]\d* result/.test(queryStatus || '');
  record(`${locale} · typing "${term}" matches results`, queryMatched, queryStatus || '');

  // 3. Clicking a type facet applies filter; URL reflects state
  const typeChip = page.locator('#search-facets .group').first().locator('.chip').first();
  const chipText = (await typeChip.textContent())?.trim() ?? '?';
  await typeChip.click();
  await page.waitForFunction(() => /filtered/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
  const filteredUrl = page.url();
  record(`${locale} · filter chip applies`, filteredUrl.includes('type='), filteredUrl);

  // 4. Hash state restoration on fresh load
  await page.goto(filteredUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
  const restoredInput = await page.inputValue('#search-input');
  const restoredActiveFilters = await page.locator('#search-active-filters .pill').count();
  record(`${locale} · hash restores input value`, restoredInput === term, `got "${restoredInput}"`);
  record(`${locale} · hash restores active filters`, restoredActiveFilters >= 2);  // 1 filter pill + 1 "clear all" pill

  // 5. Clear-all resets URL
  await page.locator('[data-clear-all]').click();
  await page.waitForTimeout(300);
  const clearedUrl = page.url();
  record(`${locale} · clear-all removes type from URL`, !clearedUrl.includes('type='));

  // 6. No-results impossible query
  await page.fill('#search-input', 'xqzbobnonexistent');
  await page.waitForFunction(() => /^0 result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
  const zeroStatus = await page.locator('#search-status').textContent();
  record(`${locale} · no-results state`, /^0 result/.test(zeroStatus || ''), zeroStatus || '');

  // 7. Locale boundary: search index doesn't include other locale's posts
  await page.fill('#search-input', '');
  await page.waitForTimeout(300);
  const allDocsStatus = await page.locator('#search-status').textContent();
  const allDocsCount = parseInt(allDocsStatus?.match(/^(\d+)/)?.[1] ?? '0');
  record(`${locale} · index isolated to locale`, allDocsCount === 4, `got ${allDocsCount} docs (expected 4 per locale)`);

  if (pageErrors.length) {
    record(`${locale} · no console pageerrors`, false, pageErrors.join('; '));
  } else {
    record(`${locale} · no console pageerrors`, true);
  }
}

// ---------- Stemming sanity (Hungarian) ----------
async function huStemming(page) {
  console.log('\n── Hungarian stemming ──');
  await page.goto(`${base}/hu`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});

  // "média" stem should match "médiá-" forms in body bodies, but not English "media" only docs.
  // For sanity, "telepítés" (the noun) should match "telepít-" verb stems in posts.
  await page.fill('#search-input', 'telepítés');
  await page.waitForFunction(() => /result/.test(document.querySelector('#search-status')?.textContent ?? '') && !/searching/.test(document.querySelector('#search-status')?.textContent ?? ''), { timeout: 5000 }).catch(() => {});
  const status = await page.locator('#search-status').textContent();
  const matched = /^[1-9]\d* result/.test(status || '');
  record('HU stemmer · "telepítés" finds at least one post', matched, status || '');
}

// ---------- Translation switcher ----------
async function translationSwitcher(page) {
  console.log('\n── Translation switcher ──');
  await page.goto(`${base}/blog/welcome`, { waitUntil: 'networkidle' });
  const huLink = page.locator('a:has-text("Magyar fordítás")');
  const huCount = await huLink.count();
  record('EN paired post has HU translation link', huCount === 1);
  if (huCount) {
    await huLink.click();
    await page.waitForURL(/\/hu\/blog\/welcome/, { timeout: 5000 }).catch(() => {});
    record('clicking switcher navigates to HU sibling', page.url().includes('/hu/blog/welcome'), page.url());
  }

  await page.goto(`${base}/blog/standalone`, { waitUntil: 'networkidle' });
  const noLink = await page.locator('a:has-text("Magyar fordítás")').count();
  record('untranslated post has no HU link', noLink === 0);
}

// ---------- Run all ----------
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await httpSmoke();
await seoSurface();
await localeOnlySeo();
await llmsTxt();
await rssCheck();
await searchFlow(page, 'en');
await searchFlow(page, 'hu');
await huStemming(page);
await translationSwitcher(page);

await browser.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log('\n' + '═'.repeat(60));
console.log(`SMOKE TEST SUMMARY — ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
console.log('═'.repeat(60));
if (failed) {
  console.log('\nFailed checks:');
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`  ❌ ${r.name}${r.detail ? ' · ' + r.detail : ''}`);
  }
}
process.exit(failed ? 1 : 0);
