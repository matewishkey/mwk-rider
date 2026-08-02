// Policy — which checks are universal Astro/web best practice, and which encode
// this project's house style.
//
// The tool ships an opinionated baseline (Cloudflare delivery, Orama search,
// Zaraz analytics, a specific file layout). Those opinions are defensible, but
// they are not things a stranger's Astro site is *wrong* for lacking. Reporting
// them as required findings buries the handful of real problems in noise, and a
// tool that cries wolf gets uninstalled.
//
// So by default, house-style checks are demoted from 🔧/🛑 to 💡 (advisory —
// they never fail the run). `--strict` turns them back into required findings,
// which is the right mode when you *are* auditing against the full baseline.
//
// A check is house-style when a reasonable Astro site could ignore it and still
// be well built. It's universal when ignoring it means a real defect: a broken
// build, a measurable performance or accessibility problem, or missing SEO
// fundamentals that every search engine and social preview depends on.

// Match on `section:name`. A trailing `*` matches any suffix — needed because
// several checks append a location or subject (`routed (src/pages/x.astro:12)`,
// `dep:@orama/orama`, `meta:og:image`).
const HOUSE_STYLE = [
  // --- stack composition: which packages a site is built from -----------------
  'modules:dep:*',              // requiring these exact integrations is house style
  'modules:search:engine',      // "search must be Orama, not Pagefind/Algolia"
  'modules:output:static',      // SSR is a legitimate choice, not a defect
  'modules:adapter:cloudflare', // only meaningful if you deploy to Cloudflare
  'modules:remotePatterns',     // R2 media-domain allowlisting
  'modules:ClientRouter',       // view transitions are a preference
  'modules:engines.node',       // declaring an engines floor is good hygiene, not a defect
  'modules:astro:version',      // being a major behind is worth knowing, not a failure
  'modules:fonts',              // a font CDN is a real cost, but a defensible choice

  // --- delivery shape: assumes Cloudflare Pages/Workers ------------------------
  'perf:_headers',              // the `_headers` file is a CF/Netlify convention
  'perf:_headers:/_astro/*',
  'images:transform:*',         // /cdn-cgi/image transform params
  'analytics:no-hardcoded-ga',  // "use Zaraz instead of a GA snippet" is our call

  // --- pages that are ours to want -------------------------------------------
  // A stranger's Astro blog is not broken for having no media kit or design
  // page. These are worth suggesting and never worth failing a build over.
  'content:mediakit',
  'content:designkit',
  // Thresholds we picked. The 🔧 tiers of css:bytes/font:bytes/font:format are
  // NOT here: 250 KB of render-blocking CSS on one page, half a megabyte of
  // webfonts, or a .ttf served to browsers are defects on anyone's site.
  'perf:css:files',
  'perf:font:families',
  'perf:font:faces',

  // --- content surface: valuable, but blog/content-site specific ---------------
  'data:llms.txt',
  'data:llms.txt:filter',
  'data:rss',
  'data:search:index',
  'data:jsonld:shapes',         // *which* shapes we demand (Article + WebSite)
                                // is our call — a site with no articles has
                                // neither and isn't wrong. jsonld:emitted and
                                // jsonld:parses stay universal.
  'seo:brand.*',                // scripts/og.config.mjs brand fields
  'seo:brand:optional',

  // --- the --url domain's twins of the above -----------------------------------
  // These mirror offline checks that are already house style. Left unclassified
  // they were *required* under --url, so a Netlify site got a hard failure for
  // missing Cloudflare `_headers` semantics that the same tool demotes to 💡 when
  // run offline — the exact cries-wolf failure this file exists to prevent.
  'perf:cache:_astro',
  // 'perf:cache:html' is deliberately NOT here. Immutable HTML means a deploy
  // stays invisible until the cache expires — a real bug on any host, and it
  // was demoted to 💡 while an optional og:image:width hint was a required 🔧.
  'analytics:zaraz',            // Zaraz specifically, not analytics in general
  'analytics:ga:raw',
  'data:llms.txt:served',
  'data:llms.txt:structure',
  'images:delivery',            // /cdn-cgi/image delivery shape
  'images:transform:*',
];

function toRegExp(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\*` here is the escaped form of a trailing wildcard in the pattern above.
  return new RegExp('^' + escaped.replace(/\\\*/g, '.*') + '$');
}

const MATCHERS = HOUSE_STYLE.map(toRegExp);

/**
 * Is this check part of the opinionated baseline rather than universal practice?
 * Location suffixes (`name (src/pages/x.astro:12)`) are stripped before matching
 * so a check keeps one policy regardless of where it fired.
 */
export function isHouseStyle(section, name) {
  const base = String(name).replace(/\s*\(.*\)\s*$/, '');
  const key = `${section}:${base}`;
  return MATCHERS.some((re) => re.test(key));
}
