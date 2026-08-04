// Policy — which checks are universal Astro/web best practice, which encode this
// project's house style, and which are advice in every mode.
//
// The tool ships an opinionated baseline (Cloudflare delivery, a specific file
// layout, a set of machine-readable endpoints). Those opinions are defensible,
// but they are not things a stranger's Astro site is *wrong* for lacking.
// Reporting them as required findings buries the handful of real problems in
// noise, and a tool that cries wolf gets uninstalled.
//
// So by default, house-style checks are demoted from 🔧/🛑 to 💡 (advisory —
// they never fail the run). `--strict` turns them back into required findings,
// which is the right mode when you *are* auditing against the full baseline.
//
// A check is house-style when a reasonable Astro site could ignore it and still
// be well built. It's universal when ignoring it means a real defect: a broken
// build, a measurable performance or accessibility problem, or missing SEO
// fundamentals that every search engine and social preview depends on.
//
// A third, smaller category is ADVISORY: checks that report a fact rather than a
// verdict, and never emit 🔧/🛑 in the first place. `--strict` does not promote
// them, because there is nothing to promote — the check has no failing branch.
// They are listed so `--rules` can say so instead of labelling them
// "[universal]", which would read as "required by default".

// Match on `section:name`. A trailing `*` matches any suffix — needed because
// several checks append a location or subject (`routed (src/pages/x.astro:12)`,
// `dep:@orama/orama`, `meta:og:image`).
const HOUSE_STYLE = [
  // --- stack composition: which packages a site is built from -----------------
  'modules:dep:*',              // requiring these exact integrations is house style
  'modules:search:engine',      // now only ever fires on TWO engines at once;
                                // kept here so the severity is unchanged by the
                                // 2026-08-03 softening rather than raised by it
  'modules:output:static',      // SSR is a legitimate choice, not a defect
  'modules:adapter:cloudflare', // only meaningful if you deploy to Cloudflare
  'modules:adapter:imageService', // ditto — and it only ever suggests anyway
  // modules:adapter:on-demand is deliberately NOT here. It names no host: a
  // prerender = false route with no adapter fails to build on Cloudflare,
  // Vercel, Netlify, Node and Deno alike, and a build that cannot run is a
  // defect on anyone's site.
  'modules:remotePatterns',     // R2 media-domain allowlisting
  'modules:ClientRouter',       // view transitions are a preference
  'modules:engines.node',       // declaring an engines floor is good hygiene, not a defect
  'modules:astro:version',      // being a major behind is worth knowing, not a failure
  'modules:fonts',              // a font CDN is a real cost, but a defensible choice

  // --- delivery shape: assumes Cloudflare Pages/Workers ------------------------
  'perf:_headers',              // the `_headers` file is a CF/Netlify convention
  'perf:_headers:/_astro/*',
  'images:transform:*',         // /cdn-cgi/image transform params
  'analytics:no-hardcoded-ga',  // the finding is real (a snippet firing before
                                // consent), but "which delivery replaces it" is
                                // still our call, so it stays advisory by default

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

// Advisory by construction — the check has no 🔧/🛑 branch at all, in either
// mode. Listing one here is a claim about its code, and tools/test.mjs asserts
// it: run the suite under --strict and none of these may report fix or block.
const ADVISORY = [
  // Whether a site measures its traffic is a business decision. The tool reports
  // what delivers analytics and moves on — including when the answer is nothing.
  // This is what lets the baseline recommend Cloudflare Web Analytics without
  // failing every site that has not set it up.
  'analytics:provider',
  // Correct prose can legitimately mix a straight quote (an inch mark, an
  // attribute quoted in a sentence) with a directional one, so this check can
  // fire on a compliant site. It reports where two smart-quote engines would
  // disagree; whether that is a bug is the author's call, never the tool's.
  'content:quotes:ambiguous',
  // A legitimately fixed-width image is common and correct — a logo, an avatar,
  // a diagram rendered at one size. The check guards against those three ways
  // (a measured width floor, a byte floor, a name filter), but it is still a
  // threshold, and art direction can justify a single width. It ships advisory
  // and only earns a 🔧 if a wider real-site sweep shows it staying quiet on
  // correct code — the promotion condition issue #12 set.
  'images:srcset:missing',
  // Diagnosis, not verdict: what the LCP is waiting for, which third parties
  // weigh the most, and how the simulated numbers compare to the observed ones.
  // The scores next to them are the verdict; these are what make one readable.
  'lighthouse:lcp:element*',
  'lighthouse:third-party:payload*',
  'lighthouse:metrics:observed*',
];

function toRegExp(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\*` here is the escaped form of a trailing wildcard in the pattern above.
  return new RegExp('^' + escaped.replace(/\\\*/g, '.*') + '$');
}

const MATCHERS = HOUSE_STYLE.map(toRegExp);
const ADVISORY_MATCHERS = ADVISORY.map(toRegExp);

// Location suffixes (`name (src/pages/x.astro:12)`) are stripped before matching
// so a check keeps one policy regardless of where it fired.
function key(section, name) {
  return `${section}:${String(name).replace(/\s*\(.*\)\s*$/, '')}`;
}

/** Is this check part of the opinionated baseline rather than universal practice? */
export function isHouseStyle(section, name) {
  const k = key(section, name);
  return MATCHERS.some((re) => re.test(k));
}

/** Does this check report a fact rather than a verdict — advice in every mode? */
export function isAdvisory(section, name) {
  const k = key(section, name);
  return ADVISORY_MATCHERS.some((re) => re.test(k));
}
