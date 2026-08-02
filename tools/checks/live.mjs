// live — runtime checks against a running/deployed URL.
//
// Where the offline checks read source + dist, this hits real URLs and verifies
// what only exists at serve time: Cache-Control headers, image routing + bytes,
// the SEO surface in rendered HTML, and machine-readable endpoints (/llms.txt).
// Only runs when --url is passed. Point it at a dev preview, a `wrangler dev` of
// dist/, or production.

import { transformSmells } from '../lib/cf-image.mjs';
import { headingLevels, headingAudit } from '../lib/html.mjs';
import { imageSize } from '../lib/image-size.mjs';

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

  await auditCache(home, head, reporter);
  const postPath = post ?? (await discoverPost(home, base, get));
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
        reporter.pass('perf', 'cache:_astro', `${cc || '(none)'}`);
      } else {
        reporter.fix(
          'perf',
          'cache:_astro',
          `Cache-Control "${cc || '(none)'}" — hashed asset not immutable (repeat visits re-validate)`,
          'ship public/_headers marking /_astro/* "public, max-age=31536000, immutable". NB: a plain `astro dev` server never applies _headers — run against `wrangler dev` of dist/ or the deployed site',
        );
      }
    }
  }

  const htmlCC = (home.headers.get('cache-control') || '').toLowerCase();
  if (/\bimmutable\b/.test(htmlCC)) {
    reporter.fix('perf', 'cache:html', `homepage Cache-Control "${htmlCC}" is immutable — deploys won't show until cache expires`, 'do not list HTML routes in _headers; let them revalidate');
  } else {
    reporter.pass('perf', 'cache:html', `homepage revalidates (${htmlCC || 'default'})`);
  }
}

// SEO — real HTML on home + a content page -----------------------------------

async function auditSeo(home, postPath, base, get, head, reporter) {
  assertHas(reporter, 'seo', 'home:canonical', home.text, /<link[^>]+rel=["']canonical["']/, 'homepage missing <link rel="canonical">');
  assertHas(reporter, 'data', 'home:jsonld-website', home.text, /"@type"\s*:\s*"WebSite"/, 'homepage missing WebSite JSON-LD');
  checkHeadings(reporter, 'home', home.text);

  if (!postPath) {
    reporter.skip('seo', 'post', 'no content page discovered to audit (pass --post <path>)');
    return;
  }
  const postRes = await get(postPath);
  if (!postRes.ok || postRes.status !== 200) {
    reporter.fix('seo', 'post', `${postPath} → ${postRes.status ?? postRes.error}`, 'expected a 200 content page');
    return;
  }
  const h = postRes.text;
  const checks = [
    ['title',        /<title>[^<]+<\/title>/,                              '<title> missing/empty'],
    ['description',  /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/, 'meta description missing'],
    ['canonical',    /<link[^>]+rel=["']canonical["']/,                    'canonical link missing'],
    ['og:title',     /<meta[^>]+property=["']og:title["']/,                'og:title missing'],
    ['og:image',     /<meta[^>]+property=["']og:image["']/,                'og:image missing'],
    ['og:image:width',  /<meta[^>]+property=["']og:image:width["']/,        'og:image:width missing'],
    ['og:image:height', /<meta[^>]+property=["']og:image:height["']/,       'og:image:height missing'],
    ['og:url',       /<meta[^>]+property=["']og:url["']/,                  'og:url missing'],
  ];
  for (const [name, re, msg] of checks) {
    assertHas(reporter, 'seo', name, h, re, msg);
  }
  checkHeadings(reporter, 'post', h);
  assertHas(reporter, 'data', 'post:jsonld', h, /"@type"\s*:\s*"BlogPosting"/, 'BlogPosting JSON-LD missing');

  const ogImg = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)?.[1];
  if (ogImg) {
    const r = await head(ogImg);
    const ct = r.headers?.get?.('content-type') || '';
    if (!(r.ok && r.status === 200 && /image\//.test(ct))) {
      reporter.fix('seo', 'og:image-resolves', `og:image ${ogImg} → ${r.status ?? r.error} (${ct || 'no content-type'})`, 'the og:image URL must resolve to a real image');
    } else {
      reporter.pass('seo', 'og:image-resolves', `${ct}`);
      // 200 + image/* is necessary but not sufficient: a screenshot of a 404
      // page is *also* a valid 200 image/png (the bug behind wishbusterz-rider#5).
      // Verify the served bytes are a real card by their intrinsic dimensions.
      await checkOgCard(ogImg, h, reporter);
    }
  }
}

// A resolvable og:image isn't proof it's a real card. A generator that screenshots
// an error page (e.g. requesting a no-trailing-slash URL on a trailingSlash:'always'
// site → 404) uploads a valid PNG that passes status + content-type — exactly how
// wishbusterz-rider#5 shipped a 404 screenshot as a post's OG image. Verify the served bytes:
// they must clear the OG minimum (600×315 — below that platforms crop/reject) and
// match the dimensions the page declares. The same-viewport case (a 404 shot at the
// real 1200×630 viewport) can't be told apart from headers/bytes; preventing *that*
// is the generator's resp.ok() guard — a site-side fix (see BEST-PRACTICES § seo),
// not something the audit can catch from outside.
async function checkOgCard(ogImg, html, reporter) {
  const buf = await fetchBytes(ogImg);
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
    const res = await fetch(url, { headers: { ...BROWSER_BASE, Accept: 'image/*,*/*;q=0.8' }, redirect: 'follow' });
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
      const src = attrs.match(/(?:^|\s)src=(["'`])([^"'`]+)\1/)?.[2];
      if (!src || isExempt(src)) continue;
      imgs.push({ src: absolutize(src, base), attrs });
    }
  }

  if (imgs.length === 0) {
    reporter.skip('images', 'delivery', 'no content <img> on audited pages — nothing to check');
    return;
  }

  let routedOk = 0, sizedOk = 0;
  const noQuality = [];
  const noAlt = [];
  for (const img of imgs) {
    // Anchor on an attribute-name boundary (not \b — see html.mjs imgsMissingAlt).
    // Dedup by src so a templated image shared across pages counts once, matching
    // the dist-side alt check's unique-src semantics.
    if (!/(?:^|\s)alt\s*=/.test(img.attrs) && !noAlt.includes(img.src)) noAlt.push(img.src);

    // Two correct paths by provenance: Astro build-time optimization for local
    // assets (/_astro/…) and Cloudflare Image Transformations for R2 content.
    const optimized = /\/_astro\//.test(img.src);
    const routed = /\/cdn-cgi\/image\//.test(img.src);
    if (optimized || routed) routedOk++;
    else reporter.fix('images', `optimized (${truncate(img.src, 70)})`, 'content image not optimized — neither Astro build (/_astro/) nor an image transform (/cdn-cgi/image/)', '<Image>/astro:assets for local assets; a /cdn-cgi/image/ URL for R2-hosted content');

    const sized = /\bwidth=/.test(img.attrs) && /\bheight=/.test(img.attrs);
    if (sized) sizedOk++;
    else reporter.fix('images', `cls (${truncate(img.src, 70)})`, 'no width/height attr → layout shift (CLS)', 'use <Image> (bakes dimensions) or add width+height');

    // Transform-param anti-patterns, visible in the URL itself.
    const smells = transformSmells(img.src);
    if (smells?.explicitFormat) {
      reporter.fix('images', `transform:format (${truncate(img.src, 60)})`, `forces format=${smells.explicitFormat} not format=auto — no AVIF, and a raw-source fallback for clients that don't accept ${smells.explicitFormat}`, 'emit format=auto so Cloudflare negotiates AVIF/webp');
    }
    if (smells?.missingQuality) noQuality.push(img.src);

    // Measure with a browser-realistic Accept so a format=auto transform
    // negotiates AVIF/webp — the bytes a real visitor downloads, not the raw source.
    const r = await head(img.src, { headers: { Accept: BROWSER_ACCEPT, 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' } });
    const len = Number(r.headers?.get?.('content-length') ?? 0);
    if (len > 300 * 1024) {
      reporter.fix('images', `bytes (${truncate(img.src, 60)})`, `${(len / 1024).toFixed(0)} KB served — over 300 KB budget`, 'lower the transform width=/use format=auto + quality=80; a hero should be 50–250 KB');
    }
  }
  if (routedOk === imgs.length) reporter.pass('images', 'routed', `${routedOk}/${imgs.length} through an image transform`);
  if (sizedOk === imgs.length)  reporter.pass('images', 'cls', `${sizedOk}/${imgs.length} have width+height`);
  if (noAlt.length === 0) reporter.pass('images', 'alt', `${imgs.length}/${imgs.length} carry an alt attribute`);
  else reporter.fix('images', 'alt', `${noAlt.length} content <img> have no alt attribute (e.g. ${truncate(noAlt[0], 70)})`, 'add alt text (alt="" only if decorative)');
  if (noQuality.length) reporter.suggest('images', 'transform:quality', `${noQuality.length} transform URL(s) set no quality= (Cloudflare defaults to 85) (e.g. ${truncate(noQuality[0], 70)})`, 'add an explicit quality (e.g. quality=80) to cap output size on photographic content');
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
      const res = await fetch(url, { headers: { ...NAV_HEADERS, ...headers }, redirect: 'follow' });
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
      let res = await fetch(url, { method: 'HEAD', headers: h, redirect: 'follow' });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { headers: { ...h, Range: 'bytes=0-0' }, redirect: 'follow' });
      }
      return { ok: true, status: res.status, headers: res.headers, url };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  };
}

function assertHas(reporter, section, name, html, re, failMsg) {
  if (re.test(html)) reporter.pass(section, name);
  else               reporter.fix(section, name, failMsg, 'emit it in the rendered HTML');
}

function checkHeadings(reporter, label, html) {
  const a = headingAudit(headingLevels(html));
  if (!a.h1) reporter.pass('seo', `headings:h1:${label}`, 'exactly one <h1>');
  else reporter.fix('seo', `headings:h1:${label}`, a.h1, 'exactly one <h1> per page (the title)');
  if (!a.skip) reporter.pass('seo', `headings:order:${label}`, 'no skipped levels');
  else reporter.suggest('seo', `headings:order:${label}`, a.skip, 'keep the outline sequential; a shared header/footer level is the usual cause');
}

function firstHashedAsset(html) {
  const m = html.match(/["'(]([^"'()]*\/_astro\/[^"'()]+\.(?:js|css))["')]/);
  return m ? m[1] : null;
}

async function discoverPost(home, base, get) {
  const m = home.text.match(/href=["']([^"']*\/blog\/[^"'/]+\/?)["']/);
  if (m) return new URL(m[1], base).pathname;
  const r = await get('/llms.txt');
  if (!r.ok) return null;
  const mm = r.text.match(/\]\((https?:\/\/[^)]*\/blog\/[^)]+)\)/);
  return mm ? new URL(mm[1]).pathname : null;
}

function isExempt(src) {
  return /\.(svg|ico)(\?|$)|\bfavicon\b/i.test(src) || src.startsWith('data:') || src.startsWith('blob:');
}

function absolutize(src, base) {
  try { return new URL(src, base).href; }
  catch { return src; }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
