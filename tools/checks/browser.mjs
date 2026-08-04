// browser — what only a real browser can tell you.
//
// Every other domain reads bytes: source files, built HTML, or the HTML a server
// returns. That misses anything decided at runtime — a script that throws, an
// asset that 404s only when the page requests it, a consent banner that never
// renders, an image downloaded at 4× the size it's displayed at. Those are the
// bugs users actually report, and they are invisible to `fetch`.
//
// Playwright is NOT a dependency of this tool. It's imported dynamically and the
// whole domain skips with instructions when it isn't installed, exactly like the
// lighthouse domain does without a key. `git clone && node audit.mjs` stays true.
//
// THE ONE PLACE THIS TOOL RUNS CODE THAT CAME FROM THE AUDITED PROJECT.
// Every other domain reads project bytes as text — config is parsed with regexes,
// never `import()`ed, so auditing a repo is not equivalent to running it. This
// domain has to import a real browser driver, and the copy that exists is
// usually the one installed in the project (see loadPlaywright below). A
// hostile repo shipping its own `node_modules/playwright` therefore gets code
// execution in the auditor process. Three things bound it, and SECURITY.md
// states it rather than claiming otherwise:
//   - it needs `--url`; the default offline audit never reaches here
//   - the tool's own resolution is tried FIRST, so a project copy only loads
//     when the auditor has none of its own
//   - whichever copy loads, the run says so out loud (`browser: playwright:source`)

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { untrusted, UNTRUSTED_NOTE } from '../lib/untrusted.mjs';

const SEC = 'browser';

/**
 * Playwright, and where it came from — `{ chromium, from }`, or null.
 *
 * Two resolutions, tried in this order:
 *
 *   1. **The tool's own tree.** Safest: nothing here came out of the audited
 *      project. Normally finds nothing, because rider ships no dependencies.
 *   2. **The audited project's `node_modules`.** The load-bearing one: rider is
 *      typically a clone somewhere else entirely, so a bare `import('playwright')`
 *      looks in the wrong tree and reports "not installed" about a project that
 *      installed it. This is also the step that executes project-supplied code —
 *      hence the order, and hence `from` being reported.
 *
 * Playwright's entry is CommonJS, so under ESM its exports arrive on `default`
 * rather than as named bindings — destructuring `{ chromium }` silently yields
 * undefined and looks exactly like "not installed". Both spellings are read.
 */
async function loadPlaywright() {
  const strategies = [
    ['the auditor’s own node_modules', () => import('playwright')],
    ['the audited project’s node_modules', () => {
      const req = createRequire(join(process.cwd(), 'package.json'));
      return import(pathToFileURL(req.resolve('playwright')).href);
    }],
  ];
  for (const [from, load] of strategies) {
    try {
      const mod = await load();
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return { chromium, from };
    } catch { /* try the next resolution strategy */ }
  }
  return null;
}

// A page that needs longer than this to become idle has a problem of its own.
const NAV_TIMEOUT_MS = 30_000;
// Below this, a 3rd-party request is noise (analytics pixels); above it, weight.
const HEAVY_REQUEST_BYTES = 250 * 1024;
// An <img> served more than this multiple of its displayed size wastes bytes.
const OVERSIZED_RATIO = 2.5;

export async function run({ reporter, url, post }) {
  const loaded = await loadPlaywright();
  if (!loaded) {
    reporter.skip(SEC, 'playwright', 'playwright not installed — run `npm i -D playwright && npx playwright install chromium` in the project you are auditing, then re-run to enable the browser domain');
    return;
  }
  const { chromium, from } = loaded;
  // Say which copy loaded. This domain is the tool's one documented exception to
  // "never executes the audited project's code" (SECURITY.md), and an exception
  // nobody can see from the output is indistinguishable from the claim being
  // false. Issue #19.
  reporter.skip(SEC, 'playwright:source', `playwright loaded from ${from} — the browser domain is the one place this tool runs code that came from the project it is auditing (see SECURITY.md)`);

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    reporter.skip(SEC, 'launch', `could not launch Chromium: ${err.message.split('\n')[0]} — try \`npx playwright install chromium\``);
    return;
  }

  try {
    const target = post ? new URL(post, url + '/').href : url;
    const page = await browser.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const responses = [];

    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? 'failed'})`));
    page.on('response', (r) => responses.push(r));

    let nav;
    try {
      nav = await page.goto(target, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      reporter.block(SEC, 'load', `${target} did not finish loading: ${err.message.split('\n')[0]}`, 'check the site is reachable and does not hang on a pending request');
      return;
    }
    if (!nav || !nav.ok()) {
      reporter.block(SEC, 'load', `${target} returned HTTP ${nav?.status() ?? '?'}`, 'the browser domain needs a page that actually loads');
      return;
    }
    reporter.pass(SEC, 'load', `${target} — HTTP ${nav.status()}`);
    // Everything below measures THIS ONE PAGE. Saying so is the difference
    // between a site-wide verdict and a homepage sample that reads like one.
    reporter.skip(SEC, 'scope', `every browser finding below is measured on ${target} alone — pass --post <path> to measure a content page instead`);
    reporter.skip(SEC, 'untrusted-input', UNTRUSTED_NOTE);

    // --- JavaScript that threw ------------------------------------------------
    // An uncaught exception can leave the page half-interactive while the HTML
    // still looks perfect to every static check.
    if (pageErrors.length === 0) {
      reporter.pass(SEC, 'js:errors', 'no uncaught exceptions');
    } else {
      reporter.fix(SEC, 'js:errors', `${pageErrors.length} uncaught exception(s), first: ${trunc(pageErrors[0], 120)}`, 'open the page with devtools and fix the throwing script — it may be leaving UI non-interactive');
    }

    if (consoleErrors.length === 0) {
      reporter.pass(SEC, 'console', 'no console errors');
    } else {
      reporter.suggest(SEC, 'console', `${consoleErrors.length} console error(s), first: ${trunc(consoleErrors[0], 120)}`, 'not always fatal, but each one is something the page tried to do and could not');
    }

    // --- Requests the browser made and could not complete ---------------------
    const notFound = responses.filter((r) => r.status() === 404).map((r) => r.url());
    if (failedRequests.length === 0 && notFound.length === 0) {
      reporter.pass(SEC, 'requests', 'every request the page made succeeded');
    } else {
      const all = [...notFound.map((u) => `404 ${u}`), ...failedRequests];
      // A 404 is the site's problem; a connection-level failure may be the
      // network this audit ran on (a blocker, a firewall, offline DNS). Say so
      // rather than blaming the site for something it may not control.
      const onlyConnection = notFound.length === 0;
      reporter.fix(SEC, 'requests', `${all.length} failed request(s), first: ${trunc(all[0], 120)}`,
        onlyConnection
          ? 'if these are connection errors rather than 404s, re-check from another network before treating it as a site bug — an ad blocker or DNS filter here can cause them'
          : 'a referenced asset is missing or blocked — static checks cannot see this because the HTML is fine');
    }

    // --- Images downloaded far larger than they are displayed -----------------
    // The offline checks compare bytes to a fixed budget; only a browser knows
    // the rendered box, which is what makes an image genuinely oversized.
    const oversized = await page.evaluate((ratio) => {
      const out = [];
      for (const img of document.querySelectorAll('img')) {
        const dw = img.naturalWidth, rw = Math.round(img.getBoundingClientRect().width);
        if (!dw || !rw) continue;
        // `sizes` — not the layout — is what picks the srcset rung, so an
        // overstated one is the CAUSE of an oversized download and the thing to
        // edit. Reported alongside so the finding names it rather than the
        // symptom: tasmanvisa-web claimed 100vw for a card rendering at 355 px
        // in a 393 px viewport, and the browser fetched 1280w/167 KB where
        // 1000w/133 KB was correct.
        if (dw / rw >= ratio) out.push({
          src: img.currentSrc || img.src,
          natural: dw,
          rendered: rw,
          sizes: img.getAttribute('sizes'),
          viewport: window.innerWidth,
        });
      }
      return out;
    }, OVERSIZED_RATIO);
    const imgCount = await page.evaluate(() => document.querySelectorAll('img').length);
    if (imgCount === 0) {
      // An identical ✅ on a page with no images is a pass for work never done.
      reporter.skip(SEC, 'images:rendered-size', 'no <img> on the audited page — nothing to measure');
    } else if (oversized.length === 0) {
      reporter.pass(SEC, 'images:rendered-size', `none of the ${imgCount} image(s) is served far larger than it is displayed`);
    } else {
      const o = oversized[0];
      // When `sizes` claims a viewport-width share the element does not occupy,
      // that is the whole explanation — say so instead of leaving the reader to
      // work back from the byte count.
      const claimsFullWidth = o.sizes != null && /(^|[\s,])100vw\s*$/.test(o.sizes) && o.rendered < o.viewport * 0.8;
      const cause = claimsFullWidth
        ? ` — sizes="${o.sizes}" claims the full ${o.viewport}px viewport for a ${o.rendered}px box, and sizes (not the layout) is what picks the srcset rung`
        : o.sizes != null ? ` (sizes="${o.sizes}")` : '';
      reporter.suggest(SEC, 'images:rendered-size', `${oversized.length} image(s) served well over their displayed size, e.g. ${o.natural}px served for a ${o.rendered}px box${cause}`, claimsFullWidth ? 'correct the sizes attribute to the width the element actually renders at' : 'set width/sizes so the transform serves the size actually rendered');
    }

    // --- Layout shift, measured rather than inferred --------------------------
    // perf:cls:img-dimensions infers CLS risk from missing attributes. This is
    // the real number, including shift caused by fonts and late-injected DOM.
    const cls = await page.evaluate(() => new Promise((resolve) => {
      let total = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { return resolve(null); }
      setTimeout(() => resolve(total), 1500);
    }));
    if (cls == null) {
      reporter.skip(SEC, 'cls:measured', 'layout-shift API unavailable in this browser build');
    } else if (cls <= 0.1) {
      reporter.pass(SEC, 'cls:measured', `${cls.toFixed(3)} (good ≤ 0.1)`);
    } else if (cls <= 0.25) {
      reporter.suggest(SEC, 'cls:measured', `${cls.toFixed(3)} — needs improvement (good ≤ 0.1)`, 'usually an image or embed without reserved space, or a font swap');
    } else {
      reporter.fix(SEC, 'cls:measured', `${cls.toFixed(3)} — poor (good ≤ 0.1)`, 'reserve space for images/embeds and preload the font that swaps');
    }

    // --- Heavy third-party weight ---------------------------------------------
    // A subdomain you own (media.example.com serving your own images) is not a
    // third party. Compare the registrable domain, not the exact origin.
    const site = registrable(new URL(target).hostname);
    const thirdParty = new Map();
    for (const r of responses) {
      let u;
      try { u = new URL(r.url()); } catch { continue; }
      if (registrable(u.hostname) === site) continue;
      const o = u.origin;
      const len = Number(r.headers()['content-length'] ?? 0);
      thirdParty.set(o, (thirdParty.get(o) ?? 0) + len);
    }
    const heavy = [...thirdParty.entries()].filter(([, b]) => b >= HEAVY_REQUEST_BYTES);
    if (heavy.length === 0) {
      reporter.pass(SEC, 'third-party', `${thirdParty.size} third-party origin(s), none over ${Math.round(HEAVY_REQUEST_BYTES / 1024)} KB`);
    } else {
      heavy.sort((a, b) => b[1] - a[1]);
      reporter.suggest(SEC, 'third-party', `${heavy.length} third-party origin(s) over ${Math.round(HEAVY_REQUEST_BYTES / 1024)} KB, heaviest ${heavy[0][0]} (${Math.round(heavy[0][1] / 1024)} KB)`, 'third-party weight blocks your own content — self-host or defer what you can');
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// Console text, exception messages and asset URLs are all written by the page
// being audited, and they land in whatever reads this output. Fence them.
const trunc = (s, n) => untrusted(s, n);

// Registrable domain, approximately: the last two labels, with a third kept for
// the common two-part public suffixes (co.uk, com.au). Good enough to tell your
// own subdomain from a genuine third party; this tool ships no PSL.
function registrable(hostname) {
  const p = hostname.toLowerCase().split('.');
  if (p.length <= 2) return hostname.toLowerCase();
  const twoPart = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;
  const last2 = p.slice(-2).join('.');
  return twoPart.test(last2) ? p.slice(-3).join('.') : last2;
}
