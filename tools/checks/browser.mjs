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

// The viewport each --strategy measures at. Mobile is the default because
// Lighthouse's is: a run that scores mobile while measuring desktop is two
// answers to the same question, and the desktop one quietly wins every time
// something only breaks on a phone. 393×852 is the Pixel-class viewport
// Lighthouse's mobile emulation uses.
const VIEWPORTS = {
  mobile: { width: 393, height: 852 },
  desktop: { width: 1280, height: 800 },
};

// The two widths nav:reach compares: the wide bar, and a phone. Fixed rather
// than taken from --strategy, because the check is a COMPARISON — it needs both
// sides whichever one the rest of the run measured at.
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 393, height: 852 };

// A control that reveals a hidden nav, matched on its label, id or class.
// Deliberately not the bare word "nav": `nav-search` matches that, and this is
// a list of things to CLICK. Plain substring rather than a word boundary,
// because a boundary drops camelCase — `mainMenu` and `navMenu` are real ids
// and a boundary misses both, while `nav-search`, `site-search` and `searchbar`
// stay unmatched either way (measured against all six).
const MENU_HINT = /(menu|hamburger|burger|drawer|nav-?toggle|toggle-?nav)/i;

export async function run({ reporter, url, post, strategy = 'mobile' }) {
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
    const viewport = VIEWPORTS[strategy] ?? VIEWPORTS.mobile;
    // `isMobile` is what makes the emulation honest rather than just narrow: it
    // applies the page's <meta viewport> and flips the pointer/hover media
    // queries, which is how a phone actually reads the CSS.
    const page = await browser.newPage({
      viewport,
      isMobile: strategy === 'mobile',
      hasTouch: strategy === 'mobile',
    });

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
    reporter.skip(SEC, 'scope', `every browser finding below is measured on ${target} alone, at ${viewport.width}×${viewport.height} (--strategy ${strategy}) — pass --post <path> to measure a content page instead`);
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

    // --- Every route the wide nav offers, still reachable on a phone ---------
    // The one failure mode nothing else here can see. The HTML carries the
    // links, no request fails, nothing throws, CLS is fine — but below the
    // breakpoint the CSS hides the bar and the control meant to bring it back
    // is missing, unstyled, or empty. Static checks read perfect markup; the
    // page has no navigation on a phone. That is how a broken hamburger ships.
    //
    // Judged as REACH, not presence. A link that leaves the bar and turns up in
    // the footer is still reachable, and moving it there is a normal call — the
    // check would be worthless if it flagged that. Only a route reachable from
    // NOWHERE at 393px is a finding.
    await navReach(browser, target, reporter);

  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Compare the primary nav at 1280px with what a 393px visitor can still reach.
 *
 * Runs in a page of its own, with no mobile emulation. The comparison is about
 * CSS width alone, and `isMobile` also flips the pointer/hover media queries —
 * a nav gated on `(hover: hover)` would read as missing for a reason that has
 * nothing to do with the breakpoint.
 *
 * Never throws: a failure here must not cost the caller the findings it already
 * has, so it degrades to a skip.
 */
async function navReach(browser, target, reporter) {
  let page;
  try {
    page = await browser.newPage({ viewport: WIDE });
    await page.goto(target, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

    const wide = await visibleLinks(page, 'nav');
    if (wide.length === 0) {
      reporter.skip(SEC, 'nav:reach', `no visible navigation links at ${WIDE.width}px — nothing to compare a narrow layout against`);
      return;
    }

    await page.setViewportSize(NARROW);
    await settle(page);
    const reachable = new Set(await visibleLinks(page, 'page'));

    // Anything already reachable needs no menu opened. Only bother when
    // something is missing — clicking things has side effects.
    let opened = 0;
    if (wide.some((h) => !reachable.has(h))) {
      const before = page.url();
      opened = await openMenus(page);
      if (opened) {
        // Wait for the LINKS, not for the DOM to go quiet. "Has it stopped
        // changing" cannot tell a page that has not started from one that has
        // finished, and both read as settled on the first two polls — measured,
        // a menu whose links were injected 600 ms after the click settled
        // instantly at zero and was reported unreachable. Polling for the thing
        // the verdict is actually made of has no such blind spot: it stops the
        // moment they are all there, and only a menu that never delivers pays
        // the full budget.
        const deadline = Date.now() + REVEAL_BUDGET_MS;
        for (;;) {
          // Belt and braces over the type=submit guard: any control that
          // navigates leaves us measuring a different page, where every link
          // legitimately looks missing. Say we could not tell rather than
          // invent a finding out of it.
          if (page.url() !== before) {
            reporter.skip(SEC, 'nav:reach', `opening the header menu navigated to ${trunc(page.url(), 100)} — cannot compare the two widths on one page`);
            return;
          }
          for (const h of await visibleLinks(page, 'page')) reachable.add(h);
          if (wide.every((h) => reachable.has(h)) || Date.now() >= deadline) break;
          await page.waitForTimeout(SETTLE_STEP_MS);
        }
      }
    }

    const missing = wide.filter((h) => !reachable.has(h));
    const control = opened ? `${opened} menu control(s) opened` : 'no menu control found in the header';

    if (missing.length === 0) {
      reporter.pass(SEC, 'nav:reach', `all ${wide.length} link(s) in the ${WIDE.width}px nav are still reachable at ${NARROW.width}px (${control})`);
    } else {
      reporter.fix(SEC, 'nav:reach',
        `${missing.length} of ${wide.length} link(s) in the ${WIDE.width}px nav are reachable from nowhere at ${NARROW.width}px — ${control}; first: ${trunc(missing[0], 120)}`,
        opened
          ? 'the menu control opens but does not carry the full list — give it the same links the wide bar has, or put the rest in the footer'
          : 'below the breakpoint the bar is hidden with nothing to reveal it — add a menu control (a <details> needs no JS), or keep the links reachable in the footer');
    }
  } catch (err) {
    reporter.skip(SEC, 'nav:reach', `could not compare the navigation across widths: ${err.message.split('\n')[0]}`);
  } finally {
    await page?.close().catch(() => {});
  }
}

// How long to let the page finish reacting before counting links, and how often
// to look. The budget is generous because it is only ever spent in full by a
// page that really is still changing.
const SETTLE_BUDGET_MS = 2000;
const SETTLE_STEP_MS = 100;
// How long a menu gets to actually produce its links once it has been opened.
const REVEAL_BUDGET_MS = 2000;

/**
 * Wait until the page stops changing shape, rather than for a fixed guess.
 *
 * A resize re-runs the CSS and a menu may be animated or built by script, so
 * the old fixed 250 ms sleep was wrong in both directions at once: pure waste
 * on the static sites that are the common case, and too short for exactly the
 * JS-driven menu this check exists to judge — a menu that faded in over 300 ms
 * would be counted while still at opacity 0 and reported as unreachable.
 *
 * So: poll the visible-link count until two consecutive reads agree, capped.
 * A settled page costs one step; a slow one gets the budget it needs. The
 * count, not a load event, is the right signal — it is the exact quantity the
 * verdict is computed from.
 */
async function settle(page, scope = 'page') {
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  let last = -1;
  for (;;) {
    const n = (await visibleLinks(page, scope)).length;
    if (n === last) return;
    last = n;
    if (Date.now() >= deadline) return;
    await page.waitForTimeout(SETTLE_STEP_MS);
  }
}

/**
 * Visible link targets right now, as absolute URLs with the fragment stripped.
 *
 * `'nav'` reads the primary navigation — a <nav> in the header, falling back
 * through the header itself to the first <nav> on the page, because plenty of
 * sites mark up only one of the two. `'page'` reads the whole document, which
 * is what "reachable" has to mean: the footer counts.
 */
function visibleLinks(page, scope) {
  return page.evaluate((scope) => {
    // A bounding rect is NOT enough, and getting this wrong passes exactly the
    // sites this check exists to fail. Chromium skips a closed <details>'s
    // subtree with content-visibility rather than zeroing its boxes, so the
    // links inside a collapsed hamburger measure 58×17 and read as on screen —
    // a menu that never opens would score a clean pass. checkVisibility() is
    // the one predicate that answers correctly (verified both ways on a closed
    // and an open <details>, 2026-09-01); the rest is a fallback for an engine
    // that does not have it.
    const visible = (el) => {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
      }
      if (el.closest('details:not([open])')) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const root = scope === 'nav'
      ? (document.querySelector('header nav')
        || document.querySelector('[role="banner"] nav')
        || document.querySelector('header')
        || document.querySelector('[role="banner"]')
        || document.querySelector('nav'))
      : document.body;
    if (!root) return [];
    const out = new Set();
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      // An in-page jump, a mail link and a phone number are not routes.
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
      if (!visible(a)) continue;
      // `/about` and `/about/` are one route, and a nav and a footer written
      // by different hands routinely disagree about the slash. Comparing raw
      // hrefs reports the footer copy as a different page and the header one as
      // unreachable — a finding about punctuation. Measured: it fired.
      try {
        const u = new URL(a.href);
        u.hash = '';
        if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
        out.add(u.href);
      } catch { /* unparseable href */ }
    }
    return [...out];
  }, scope);
}

/**
 * Open whatever in the header looks like it reveals a hidden menu, and say how
 * many. <details> is opened by property rather than by clicking its summary —
 * the summary is a toggle, so clicking one already open closes it again.
 */
function openMenus(page) {
  return page.evaluate((hintSource) => {
    const hint = new RegExp(hintSource, 'i');
    const scope = document.querySelector('header, [role="banner"]') || document.body;
    let opened = 0;

    for (const d of scope.querySelectorAll('details')) {
      if (!d.open) { d.open = true; opened++; }
    }

    const label = (el) => [el.getAttribute('aria-label'), el.id, typeof el.className === 'string' ? el.className : ''].join(' ');
    const isToggle = (el) => el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') || hint.test(label(el));

    for (const el of scope.querySelectorAll('button, summary, input[type="checkbox"]')) {
      if (!isToggle(el)) continue;
      // Already handled above, and clicking it would close it.
      if (el.tagName === 'SUMMARY' && el.closest('details')?.open) continue;
      if (el.getAttribute('aria-expanded') === 'true') continue;
      // A <button> in a form defaults to type=submit, and a search box's button
      // carrying aria-controls matches the toggle test exactly. Clicking it
      // navigates away and takes the measurement with it — every link then
      // reads as unreachable. A bare hamburger button has no form, so it is
      // unaffected. Measured: without this the check reported 2 of 2 missing on
      // a page whose menu was perfectly fine.
      if (el.tagName === 'BUTTON' && el.form && el.type !== 'button') continue;
      try {
        if (el.tagName === 'INPUT') {
          if (el.checked) continue;
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.click();
        }
        opened++;
      } catch { /* a toggle that throws is the site's bug, not this check's */ }
    }
    return opened;
  }, MENU_HINT.source);
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
