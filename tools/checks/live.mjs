// live — runtime checks against a running/deployed URL.
//
// Where the offline checks read source + dist, this hits real URLs and verifies
// what only exists at serve time: Cache-Control headers, image routing + bytes,
// the SEO surface in rendered HTML, and machine-readable endpoints (/llms.txt).
// Only runs when --url is passed. Point it at a dev preview, a `wrangler dev` of
// dist/, or production.

import { transformSmells } from '../lib/cf-image.mjs';
import { headingLevels, headingAudit, attrValue, hasAttr } from '../lib/html.mjs';
import { imageSize } from '../lib/image-size.mjs';
import { collectJsonLd, ldTypes, hasArticleType } from '../lib/jsonld.mjs';
import { untrusted, capped, UNTRUSTED_NOTE } from '../lib/untrusted.mjs';

// One image loop can otherwise emit a finding per <img> on a page that has
// hundreds — or that was built to have hundreds.
const MAX_IMAGE_FINDINGS = 25;

// Neither `astro dev` nor `astro preview` applies _headers (measured), so a
// cache verdict against one says nothing about the deploy — in either
// direction. The sibling check carried this caveat and the other did not.
const LOCAL_CAVEAT = ' — NB against `astro dev`/`astro preview` this proves nothing: neither applies _headers. Judge it on `wrangler dev` of dist/ or the deployed site';

// A host that accepts the connection and never answers used to hang the audit
// indefinitely — in CI, forever.
const NET_TIMEOUT_MS = 15_000;

// What a modern browser sends for an image — so a format=auto transform negotiates
// AVIF/webp and the measured bytes reflect what a real visitor actually downloads.
const BROWSER_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

// A minimal browser identity, safe on any request (page or sub-resource).
const BROWSER_BASE = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
};

// A full top-level-navigation signature. A headerless fetch is bot-scored by
// Cloudflare as automated, and Zaraz's "Block bot initiated requests" setting
// (bot-score based — same effect as Bot Fight Mode) then suppresses the
// edge-injected /cdn-cgi/zaraz/i.js loader. So a curl-shaped probe never sees
// Zaraz, even when it is correctly configured. Sending what a browser sends for a
// document request gets the fully-injected page a real visitor receives.
// (Cloudflare docs: Zaraz Settings → "Block bot initiated requests".)
const NAV_HEADERS = {
  ...BROWSER_BASE,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export async function run({ base, reporter, post }) {
  const get = mkGet(base);
  const head = mkHead(base);

  // Reachability
  const home = await get('/');
  if (!home.ok) {
    reporter.block('live', 'reachability', `cannot reach ${home.url}: ${home.error}`, 'is the server running? check the URL/port');
    return;
  }
  if (home.status !== 200) {
    reporter.block('live', 'reachability', `${base}/ returned ${home.status}`, 'expected 200 for the homepage');
    return;
  }
  reporter.pass('live', 'reachability', `${base}/ → 200`);
  reporter.skip('live', 'untrusted-input', UNTRUSTED_NOTE);

  await auditCache(home, head, reporter);
  const postPath = await resolveSlash(post ?? (await discoverPost(home, base, get)), get);
  await auditSeo(home, postPath, base, get, head, reporter);
  await auditImages(home, postPath, base, get, head, reporter);
  await auditData(get, reporter);
  auditAnalytics(home, reporter);
}

// Analytics — Cloudflare Zaraz is the promoted delivery: it loads Google Analytics
// (via GTM) at the edge behind its consent CMP (the cookie banner), and the loader
// (/cdn-cgi/zaraz/) is the one signal present in served HTML. The banner render +
// whether tags hold for consent are client-JS runtime, needing a headless browser
// we don't run (tracked as a Gap). The anti-pattern is a THIRD-PARTY GA loader
// (googletagmanager.com / google-analytics.com) — that fires outside Zaraz's consent
// gate. A bare gtag() *call* is NOT flagged live: Zaraz injects the bootstrap into
// the rendered HTML, so keying on the call (as the offline scan does for source)
// would false-flag every compliant served page. NB the loader is only visible
// because the page GET carries a browser navigation signature (NAV_HEADERS) — a
// headerless probe is bot-scored and the edge suppresses the Zaraz injection.
function auditAnalytics(home, reporter) {
  const html = home.text;
  const zaraz = /\/cdn-cgi\/zaraz\//.test(html);
  const thirdPartyGa = /googletagmanager\.com\/(?:gtag\/js|gtm\.js)|google-analytics\.com\/(?:analytics|ga)\.js/i.test(html);

  if (zaraz) {
    reporter.pass('analytics', 'zaraz', 'Cloudflare Zaraz loader present (/cdn-cgi/zaraz/) — analytics is Zaraz-managed at the edge. NB: confirms the loader only; the consent CMP actually rendering + tags holding for consent are client-side runtime, not checked here (see BEST-PRACTICES § Gaps)');
    if (thirdPartyGa) {
      reporter.fix('analytics', 'ga:raw', 'Google Analytics is ALSO loaded directly from googletagmanager.com — it bypasses Zaraz and fires outside consent', 'remove the hardcoded third-party GA loader; let Zaraz deliver it behind the consent banner');
    }
  } else if (thirdPartyGa) {
    reporter.fix('analytics', 'zaraz', 'Google Analytics is loaded directly from googletagmanager.com and no Zaraz loader (/cdn-cgi/zaraz/) is present — it fires without consent', 'load GA through Cloudflare Zaraz so the consent CMP gates it');
  } else {
    reporter.skip('analytics', 'zaraz', 'no Zaraz loader and no third-party GA in served HTML — nothing to verify. The probe sends a browser navigation signature, so Zaraz is genuinely absent (not configured), or the edge blocks ALL bot traffic / a WAF rule strips the loader. Consent-banner render + pre-consent firing also need a real browser, not done here');
  }
}

// Cache — hashed assets immutable, HTML revalidates --------------------------

async function auditCache(home, head, reporter) {
  const asset = firstHashedAsset(home.text);
  if (!asset) {
    reporter.skip('perf', 'cache:_astro', 'no /_astro/* asset referenced on homepage — nothing to check');
  } else {
    const r = await head(asset);
    if (!r.ok || r.status >= 400) {
      reporter.fix('perf', 'cache:_astro', `${asset} → ${r.status ?? r.error}`, 'hashed asset should be reachable');
    } else {
      const cc = (r.headers.get('cache-control') || '').toLowerCase();
      const immutable = /\bimmutable\b/.test(cc);
      const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1] ?? 0);
      if (immutable && maxAge >= 86400) {
        reporter.pass('perf', 'cache:_astro', `${untrusted(cc || '(none)', 80)}${LOCAL_CAVEAT}`);
      } else {
        reporter.fix(
          'perf',
          'cache:_astro',
          `Cache-Control ${untrusted(cc || '(none)', 80)} — hashed asset not immutable (repeat visits re-validate)`,
          'ship public/_headers marking /_astro/* "public, max-age=31536000, immutable". NB: neither `astro dev` nor `astro preview` applies _headers — both serve /_astro/* as no-cache regardless (measured), so this fires against them even when the file is correct and the offline perf:_headers check passes on the same tree. Run against `wrangler dev` of dist/ or the deployed site to judge it',
        );
      }
    }
  }

  const htmlCC = (home.headers.get('cache-control') || '').toLowerCase();
  if (/\bimmutable\b/.test(htmlCC)) {
    reporter.fix('perf', 'cache:html', `homepage Cache-Control ${untrusted(htmlCC, 80)} is immutable — deploys won't show until cache expires`, 'do not list HTML routes in _headers; let them revalidate');
  } else {
    reporter.pass('perf', 'cache:html', `homepage revalidates (${untrusted(htmlCC || 'default', 80)})${LOCAL_CAVEAT}`);
  }
}

// SEO — real HTML on home + a content page -----------------------------------

// What is lost when no content page can be found. Listing them is the whole
// point: "clean" must never be indistinguishable from "didn't run".
const POST_ONLY_CHECKS = [
  'seo/title', 'seo/description', 'seo/canonical', 'seo/og-title', 'seo/og-image',
  'seo/og-image-width', 'seo/og-image-height', 'seo/og-url', 'seo/og-image-resolves',
  'seo/og-image-card', 'seo/headings-h1', 'seo/headings-order', 'data/post-jsonld',
];

async function auditSeo(home, postPath, base, get, head, reporter) {
  assertHas(reporter, 'seo', 'home:canonical', home.text, /<link[^>]+rel=["']canonical["']/, 'homepage missing <link rel="canonical">');
  checkLdTypes(reporter, 'home:jsonld-website', home.text, (t) => t.has('WebSite'),
    'homepage emits no WebSite JSON-LD', 'emit a site-wide WebSite shape from the head component');
  checkHeadings(reporter, 'home', home.text);

  if (!postPath) {
    // Name what didn't run. Two dogfood runs printed "audit clean — exit 0"
    // having skipped this whole block: silence read exactly like a pass.
    reporter.skip('seo', 'post', `no content page found in the sitemap, homepage links or /llms.txt — these did NOT run: ${POST_ONLY_CHECKS.join(', ')}. Pass --post <path> to audit a specific page`);
    return;
  }
  const postRes = await get(postPath);
  if (!postRes.ok || postRes.status !== 200) {
    // Naming the casualties matters most HERE. This path used to return in
    // silence, so a 404 on one URL voided thirteen checks and the run still
    // read as though the site had been audited.
    reporter.fix('seo', 'post', `${postPath} → ${postRes.status ?? postRes.error}; these did NOT run: ${POST_ONLY_CHECKS.join(', ')}`, 'pass --post <path> with a URL that answers 200', { url: postPath });
    return;
  }
  const h = postRes.text;
  const checks = [
    ['title',        /<title>[^<]+<\/title>/,                              '<title> missing/empty'],
    ['description',  /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/, 'meta description missing'],
    ['canonical',    /<link[^>]+rel=["']canonical["']/,                    'canonical link missing'],
    ['og:title',     /<meta[^>]+property=["']og:title["']/,                'og:title missing'],
    ['og:image',     /<meta[^>]+property=["']og:image["']/,                'og:image missing'],
    ['og:image:width',  /<meta[^>]+property=["']og:image:width["']/,        'og:image:width missing', 'suggest'],
    ['og:image:height', /<meta[^>]+property=["']og:image:height["']/,       'og:image:height missing', 'suggest'],
    ['og:url',       /<meta[^>]+property=["']og:url["']/,                  'og:url missing'],
  ];
  for (const [name, re, msg, severity] of checks) {
    assertHas(reporter, 'seo', name, h, re, msg, severity);
  }
  checkHeadings(reporter, 'post', h);
  checkLdTypes(reporter, 'post:jsonld', h, hasArticleType,
    'content page emits no Article-family JSON-LD (Article/BlogPosting/NewsArticle/TechArticle…)',
    'emit an Article-family shape per post', { url: postPath });

  const ogImgRaw = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)?.[1];
  if (ogImgRaw) {
    const ogImg = rebaseOnAudited(ogImgRaw, h, base);
    const r = await head(ogImg);
    const ct = r.headers?.get?.('content-type') || '';
    if (!(r.ok && r.status === 200 && /image\//.test(ct))) {
      reporter.fix('seo', 'og:image-resolves', `og:image → ${r.status ?? r.error} (${untrusted(ct || 'no content-type', 60)})`, 'the og:image URL must resolve to a real image', { url: ogImg });
    } else {
      reporter.pass('seo', 'og:image-resolves', untrusted(ct, 60), { url: ogImg });
      // 200 + image/* is necessary but not sufficient: a screenshot of a 404
      // page is *also* a valid 200 image/png (the bug behind mergodon/td-rider#5).
      // Verify the served bytes are a real card by their intrinsic dimensions.
      await checkOgCard(ogImg, h, reporter, base);
    }
  }
}

/**
 * Point a self-hosted asset URL at the site being audited.
 *
 * og:image is built from the *production* siteUrl, so auditing localhost or a
 * staging deploy fetched production — or, on a site not yet live, nothing at
 * all, and the check could never pass. Rebasing only applies when the asset sits
 * on the page's own declared origin (its canonical/og:url): a genuine separate
 * media host (R2, a CDN) is fetched exactly as written, because that URL is what
 * a social scraper will really request.
 */
function rebaseOnAudited(assetUrl, html, base) {
  let asset, audited;
  try { audited = new URL(base); } catch { return assetUrl; }
  try { asset = new URL(assetUrl, base); } catch { return assetUrl; }
  if (asset.origin === audited.origin) return asset.href;

  const declared = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/)?.[1]
                ?? html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/)?.[1];
  let declaredOrigin = null;
  try { declaredOrigin = declared ? new URL(declared, base).origin : null; } catch {}
  if (declaredOrigin && asset.origin === declaredOrigin) {
    return new URL(asset.pathname + asset.search, audited.origin).href;
  }
  return asset.href;
}

// A resolvable og:image isn't proof it's a real card. A generator that screenshots
// an error page (e.g. requesting a no-trailing-slash URL on a trailingSlash:'always'
// site → 404) uploads a valid PNG that passes status + content-type — exactly how
// mergodon/td-rider#5 shipped a 404 screenshot as a post's OG image. Verify the served bytes:
// they must clear the OG minimum (600×315 — below that platforms crop/reject) and
// match the dimensions the page declares. The same-viewport case (a 404 shot at the
// real 1200×630 viewport) can't be told apart from headers/bytes; preventing *that*
// is the generator's resp.ok() guard — a site-side fix (see BEST-PRACTICES § seo),
// not something the audit can catch from outside.
async function checkOgCard(ogImg, html, reporter, base) {
  if (!/\.(png|jpe?g)(\?|#|$)/i.test(new URL(ogImg, base).pathname)) {
    reporter.skip('seo', 'og:image:card', 'card is not PNG/JPEG — its intrinsic size cannot be read from the bytes, so the 600×315 minimum was NOT verified', { url: ogImg });
    return;
  }
  // A relative og:image used to throw inside fetchBytes and be swallowed, so the
  // check emitted no line at all — indistinguishable from "card is fine".
  const buf = await fetchBytes(absolutize(ogImg, base));
  const size = buf && imageSize(buf);
  if (!size) return; // format we don't parse (WebP/AVIF/SVG) — leave the resolves pass standing
  const { w, h } = size;
  const declaredW = Number(html.match(/<meta[^>]+property=["']og:image:width["'][^>]+content=["'](\d+)["']/)?.[1]) || 0;
  const declaredH = Number(html.match(/<meta[^>]+property=["']og:image:height["'][^>]+content=["'](\d+)["']/)?.[1]) || 0;
  if (w < 600 || h < 315) {
    reporter.fix('seo', 'og:image:card', `served og:image is ${w}×${h} — below the 600×315 OG minimum (a placeholder, icon, or error-page screenshot, not a real card)`, 'serve a real ~1200×630 card; guard the generator with resp.ok() before it screenshots + uploads');
  } else if (declaredW && declaredH && (w !== declaredW || h !== declaredH)) {
    reporter.suggest('seo', 'og:image:dimensions', `served card is ${w}×${h} but og:image:width/height declare ${declaredW}×${declaredH}`, 'match the meta to the real card (or regenerate the card) so crawlers size it correctly');
  } else {
    reporter.pass('seo', 'og:image:card', `${w}×${h}`);
  }
}

// Fetch raw bytes for a resolved sub-resource (image), browser-shaped so a CDN
// doesn't bot-score the probe. Returns an ArrayBuffer, or null on any failure.
async function fetchBytes(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS), headers: { ...BROWSER_BASE, Accept: 'image/*,*/*;q=0.8' }, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch { return null; }
}

// Images — content imgs routed + sized + under byte budget -------------------

async function auditImages(home, postPath, base, get, head, reporter) {
  const pages = [home];
  if (postPath) {
    const p = await get(postPath);
    if (p.ok && p.status === 200) pages.push(p);
  }

  const imgs = [];
  for (const page of pages) {
    const re = /<img\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(page.text)) !== null) {
      const attrs = m[1];
      const src = attrValue(attrs, 'src');
      if (!src || isExempt(src)) continue;
      // Resolve against the page, not the site root: `images/x.png` on
      // /blog/hello/ is /blog/hello/images/x.png. Resolving against base gave a
      // wrong URL in the finding and a 404 that silently voided the byte check.
      imgs.push({ src: absolutize(src, page.url ?? base), attrs });
    }
  }

  if (imgs.length === 0) {
    // Name each one. A single "delivery: nothing to check" left routed/cls/alt
    // absent from the output entirely, which reads as though they passed.
    const why = 'no content <img> on the audited pages — nothing to check';
    for (const name of ['routed', 'cls', 'alt', 'bytes']) reporter.skip('images', name, why);
    return;
  }

  let routedOk = 0, sizedOk = 0;
  const noQuality = [];
  const noAlt = [];
  const { shown: inspected, dropped } = capped(imgs, MAX_IMAGE_FINDINGS);
  if (dropped) {
    reporter.skip('images', 'delivery', `${imgs.length} content images found; inspecting the first ${MAX_IMAGE_FINDINGS}. ${dropped} not measured`);
  }
  for (const img of inspected) {
    // hasAttr, not a local regex: it accepts the bare `alt` that Astro emits for
    // alt="" (see html.mjs), so a decorative image isn't reported as missing alt.
    // Dedup by src so a templated image shared across pages counts once, matching
    // the dist-side alt check's unique-src semantics.
    if (!hasAttr(img.attrs, 'alt') && !noAlt.includes(img.src)) noAlt.push(img.src);

    // Two correct paths by provenance: Astro build-time optimization for local
    // assets (/_astro/…) and Cloudflare Image Transformations for R2 content.
    const optimized = /\/_astro\//.test(img.src);
    const routed = /\/cdn-cgi\/image\//.test(img.src);
    if (optimized || routed) routedOk++;
    else reporter.fix('images', 'routed', 'content image not optimized — neither Astro build (/_astro/) nor an image transform (/cdn-cgi/image/)', '<Image>/astro:assets for local assets; a /cdn-cgi/image/ URL for R2-hosted content', { url: img.src });

    // attrValue, not /\bwidth=/: \b matches inside `data-width=`, so a tag with
    // only data-attributes passed the CLS check. A value is required — a bare
    // `width` reserves no space.
    const sized = attrValue(img.attrs, 'width') != null && attrValue(img.attrs, 'height') != null;
    if (sized) sizedOk++;
    else reporter.fix('images', 'cls', 'no width/height attr → layout shift (CLS)', 'use <Image> (bakes dimensions) or add width+height', { url: img.src });

    // Transform-param anti-patterns, visible in the URL itself.
    const smells = transformSmells(img.src);
    if (smells?.explicitFormat) {
      reporter.fix('images', 'transform:format', `forces format=${smells.explicitFormat} not format=auto — no AVIF, and a raw-source fallback for clients that don't accept ${smells.explicitFormat}`, 'emit format=auto so Cloudflare negotiates AVIF/webp', { url: img.src });
    }
    if (smells?.missingQuality) noQuality.push(img.src);

    // Measure with a browser-realistic Accept so a format=auto transform
    // negotiates AVIF/webp — the bytes a real visitor downloads, not the raw source.
    const r = await head(img.src, { headers: { Accept: BROWSER_ACCEPT, 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' } });
    const len = Number(r.headers?.get?.('content-length') ?? 0);
    if (len > 300 * 1024) {
      reporter.fix('images', 'bytes', `${(len / 1024).toFixed(0)} KB served — over 300 KB budget`, 'lower the transform width=/use format=auto + quality=80; a hero should be 50–250 KB', { url: img.src });
    }
  }
  const sampled = `on ${pages.length === 1 ? 'the homepage only' : `${pages.length} pages`}`;
  if (routedOk === inspected.length) reporter.pass('images', 'routed', `${routedOk}/${inspected.length} through an image transform, ${sampled}`);
  if (sizedOk === inspected.length)  reporter.pass('images', 'cls', `${sizedOk}/${inspected.length} have width+height, ${sampled}`);
  if (noAlt.length === 0) reporter.pass('images', 'alt', `${inspected.length}/${inspected.length} carry an alt attribute, ${sampled}`);
  else reporter.fix('images', 'alt', `${noAlt.length} content <img> have no alt attribute`, 'add alt text (alt="" only if decorative)', { url: noAlt[0] });
  if (noQuality.length) reporter.suggest('images', 'transform:quality', `${noQuality.length} transform URL(s) set no quality= (Cloudflare defaults to 85)`, 'add an explicit quality (e.g. quality=80) to cap output size on photographic content', { url: noQuality[0] });
}

// Data — machine-readable endpoints ------------------------------------------

async function auditData(get, reporter) {
  const r = await get('/llms.txt');
  if (!r.ok || r.status !== 200) {
    reporter.fix('data', 'llms.txt', `/llms.txt → ${r.status ?? r.error}`, 'add a src/pages/llms.txt.ts endpoint built from getCollection()');
    return;
  }
  reporter.pass('data', 'llms.txt:served', '200');
  assertHas(reporter, 'data', 'llms.txt:h1', r.text, /^#\s+\S/m, '/llms.txt has no H1');
  const grouped = /^##\s+\S/m.test(r.text);
  const indexed = /llms-[a-z]{2}\.txt/.test(r.text);
  if (grouped || indexed) reporter.pass('data', 'llms.txt:structure', grouped ? 'grouped by type' : 'index → per-locale');
  else reporter.fix('data', 'llms.txt:structure', 'no ## section groups and no per-locale links', 'group entries by type/section');
}

// Helpers --------------------------------------------------------------------

function mkGet(base) {
  return async function get(path, { headers } = {}) {
    const url = path.startsWith('http') ? path : base + path;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS), headers: { ...NAV_HEADERS, ...headers }, redirect: 'follow' });
      const text = await res.text();
      return { ok: true, status: res.status, headers: res.headers, text, url };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  };
}

function mkHead(base) {
  return async function head(path, { headers } = {}) {
    const url = path.startsWith('http') ? path : base + path;
    const h = { ...BROWSER_BASE, ...headers };
    try {
      let res = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS), method: 'HEAD', headers: h, redirect: 'follow' });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS), headers: { ...h, Range: 'bytes=0-0' }, redirect: 'follow' });
      }
      return { ok: true, status: res.status, headers: res.headers, url };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  };
}

function assertHas(reporter, section, name, html, re, failMsg, severity = 'fix') {
  if (re.test(html)) reporter.pass(section, name);
  else if (severity === 'suggest') reporter.suggest(section, name, failMsg, 'emit it in the rendered HTML — platforms lay the card out before fetching it');
  else reporter.fix(section, name, failMsg, 'emit it in the rendered HTML');
}

// Parse the JSON-LD rather than substring-matching it: a page emitting Article
// where we looked for the literal "BlogPosting" was reported as having none, and
// a @graph-wrapped shape was invisible to the regex either way.
function checkLdTypes(reporter, name, html, predicate, failMsg, fixMsg, at = {}) {
  const { objects } = collectJsonLd(html);
  const types = ldTypes(objects);
  const shown = untrusted([...types].sort().join(', '), 160);
  if (predicate(types)) reporter.pass('data', name, shown, at);
  else reporter.fix('data', name, `${failMsg}${types.size ? ` — found: ${shown}` : ''}`, fixMsg, at);
}

// `label` is which page was read (home / a content path). It's the location of
// the finding, not a different rule — so it rides in `url`, and both pages
// report under one stable id.
function checkHeadings(reporter, label, html) {
  const a = headingAudit(headingLevels(html));
  const at = { url: label };
  if (!a.h1) reporter.pass('seo', 'headings:h1', 'exactly one <h1>', at);
  else reporter.fix('seo', 'headings:h1', a.h1, 'exactly one <h1> per page (the title)', at);
  if (!a.skip) reporter.pass('seo', 'headings:order', 'no skipped levels', at);
  else reporter.suggest('seo', 'headings:order', a.skip, 'keep the outline sequential; a shared header/footer level is the usual cause', at);
}

function firstHashedAsset(html) {
  const m = html.match(/["'(]([^"'()]*\/_astro\/[^"'()]+\.(?:js|css))["')]/);
  return m ? m[1] : null;
}

// Routes that exist on nearly every site and are not the content page we want
// to audit. Matched on the whole path, lowercased.
const INDEX_ROUTES = new Set([
  '/', '/about', '/contact', '/blog', '/posts', '/articles', '/notes', '/writing',
  '/projects', '/work', '/wiki', '/docs', '/search', '/tags', '/categories',
  '/archive', '/now', '/uses', '/privacy', '/terms', '/imprint', '/legal',
  '/404', '/rss', '/feed', '/sitemap',
]);
const NON_PAGE_EXT = /\.(xml|json|txt|rss|atom|png|jpe?g|webp|avif|gif|svg|ico|pdf|css|js|mjs|zip)$/i;
// /blog/2, /page/3 — pagination, same template as its index.
const PAGINATION = /\/(?:page\/)?\d+\/?$/;

/**
 * Find a content page to audit.
 *
 * This used to match `href="…/blog/…"` and nothing else. Every one of five
 * dogfood sites used /projects/ and /wiki/ instead, so around ten live checks
 * silently never ran and two runs printed "audit clean, exit 0" having checked
 * almost nothing. Forcing --post turned one of them into four findings.
 *
 * Order matters: the sitemap is the site's own declaration of its content URLs,
 * so it beats guessing from markup. Homepage links are the fallback, /llms.txt
 * the last resort.
 */
async function discoverPost(home, base, get) {
  const fromSitemap = await sitemapCandidates(base, get);
  const best = pickContentPath(fromSitemap, base);
  if (best) return best;

  // Anchors only. A bare href= scan also picks up <link rel="canonical">, so a
  // page pointing at itself "discovered" itself and the audit read one page twice.
  const links = [...home.text.matchAll(/<a\b[^>]*?\shref=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const fromLinks = pickContentPath(links, base);
  if (fromLinks) return fromLinks;

  const r = await get('/llms.txt');
  if (!r.ok) return null;
  return pickContentPath([...r.text.matchAll(/\]\((\S+?)\)/g)].map((m) => m[1]), base);
}

/**
 * A site with `trailingSlash: 'always'` (or 'never') answers on exactly one
 * form. Try the other before letting a slash abandon thirteen checks.
 */
async function resolveSlash(path, get) {
  if (!path) return path;
  const first = await get(path);
  if (first.ok && first.status === 200) return path;
  const flipped = path.endsWith('/') ? (path.replace(/\/+$/, '') || '/') : path + '/';
  if (flipped === path) return path;
  const alt = await get(flipped);
  return (alt.ok && alt.status === 200) ? flipped : path;
}

async function sitemapCandidates(base, get) {
  const out = [];
  for (const entry of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-0.xml']) {
    const r = await get(entry);
    if (!r.ok || r.status !== 200 || !/<(?:urlset|sitemapindex)/i.test(r.text)) continue;
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // An index lists other sitemaps; follow a bounded number of them.
    if (/<sitemapindex/i.test(r.text)) {
      for (const child of locs.slice(0, 3)) {
        const c = await get(child);
        if (c.ok && c.status === 200) out.push(...[...c.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
      }
    } else {
      out.push(...locs);
    }
    if (out.length) break;
  }
  return out;
}

/**
 * The most content-shaped path in a list of URLs. Deeper paths win: /blog/x or
 * /wiki/y is a leaf, /blog is its index. Same-origin only — an outbound link is
 * not this site's content.
 */
function pickContentPath(urls, base) {
  const origin = new URL(base).origin;
  const paths = [];
  for (const u of urls) {
    let path;
    try {
      const abs = new URL(u, base);
      if (abs.origin !== origin) continue;
      // Keep the trailing slash EXACTLY as the site declared it. Normalising it
      // away requested /wiki/x on a `trailingSlash: 'always'` site, which 404s —
      // the sitemap had just told us the canonical form and we discarded it.
      path = abs.pathname || '/';
    } catch { continue; }
    const bare = path.replace(/\/+$/, '') || '/';
    if (NON_PAGE_EXT.test(bare)) continue;
    if (INDEX_ROUTES.has(bare.toLowerCase())) continue;
    if (PAGINATION.test(bare)) continue;
    // A single leading segment that is itself an index route ("/blog/tag/x")
    // still counts as content; a bare "/tag/x" listing does not.
    if (/^\/(?:tags?|categor(?:y|ies)|author)\//i.test(bare)) continue;
    if (!paths.includes(path)) paths.push(path);
  }
  if (!paths.length) return null;
  // Deepest first, then shortest — a leaf article over a section landing page.
  paths.sort((a, b) => depth(b) - depth(a) || a.length - b.length);
  return paths[0];
}

function depth(path) {
  return path.split('/').filter(Boolean).length;
}

function isExempt(src) {
  return /\.(svg|ico)(\?|$)|\bfavicon\b/i.test(src) || src.startsWith('data:') || src.startsWith('blob:');
}

function absolutize(src, base) {
  try { return new URL(src, base).href; }
  catch { return src; }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
