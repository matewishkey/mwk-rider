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

  // --- delivery shape: assumes Cloudflare Pages/Workers ------------------------
  'perf:_headers',              // the `_headers` file is a CF/Netlify convention
  'perf:_headers:/_astro/*',
  'images:transform:*',         // /cdn-cgi/image transform params
  'analytics:no-hardcoded-ga',  // "use Zaraz instead of a GA snippet" is our call

  // --- content surface: valuable, but blog/content-site specific ---------------
  'data:llms.txt',
  'data:llms.txt:filter',
  'data:rss',
  'data:search:index',
  'data:jsonld:shapes',         // demands src/lib/jsonld.ts specifically
  'seo:brand.*',                // scripts/og.config.mjs brand fields
  'seo:brand:optional',

  // --- the --url domain's twins of the above -----------------------------------
  // These mirror offline checks that are already house style. Left unclassified
  // they were *required* under --url, so a Netlify site got a hard failure for
  // missing Cloudflare `_headers` semantics that the same tool demotes to 💡 when
  // run offline — the exact cries-wolf failure this file exists to prevent.
  'perf:cache:_astro',
  'perf:cache:html',
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
