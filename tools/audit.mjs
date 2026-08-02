#!/usr/bin/env node
// wishbusterz-rider — check an Astro site against baseline best practices.
//
// Six offline domains read source + dist:
//   modules   expected baseline integrations + config are present and wired
//   seo       canonical, title/description, OG meta, sitemap
//   images    content images routed through a transform + not oversized
//   perf      immutable cache headers for hashed assets + no-CLS <img>
//   data      machine-readable surface: JSON-LD, /llms.txt, RSS
//   analytics no hardcoded Google Analytics/GTM snippet (delivered via Zaraz)
//
// Pass --url <base> to also run, against a running/deployed site:
//   live        real headers, served image bytes, rendered HTML
//   lighthouse  real PageSpeed Insights scores + Core Web Vitals (needs a PSI key)
//   browser     what only a real browser sees: JS errors, failed requests,
//               measured CLS, images oversized for their rendered box
//               (needs playwright installed; skips without it)
//
// Usage: node audit.mjs --help

import { parseArgs } from 'node:util';
import { detectProject } from './lib/project.mjs';
import { Reporter } from './lib/reporter.mjs';

const OFFLINE = {
  modules: () => import('./checks/modules.mjs'),
  seo:     () => import('./checks/seo.mjs'),
  images:  () => import('./checks/images.mjs'),
  perf:    () => import('./checks/perf.mjs'),
  data:    () => import('./checks/data.mjs'),
  analytics: () => import('./checks/analytics.mjs'),
};
const URL_ONLY = ['live', 'lighthouse', 'browser'];
const ALL_DOMAINS = [...Object.keys(OFFLINE), ...URL_ONLY];
const STRATEGIES = ['mobile', 'desktop'];

// parseArgs throws a raw ERR_PARSE_ARGS_* on a bad flag; its stack trace and its
// hint about positional arguments are noise to someone who just made a typo.
let values;
try {
  ({ values } = parseArgs({
    options: {
      section:  { type: 'string', short: 's', multiple: true },
      url:      { type: 'string' },
      post:     { type: 'string' },
      strategy: { type: 'string' },
      strict:   { type: 'boolean' },
      json:     { type: 'boolean' },
      quiet:    { type: 'boolean' },
      help:     { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  }));
} catch (err) {
  console.error(`error: ${err.message.split('.')[0]}`);
  console.error('run with --help to see the available options.');
  process.exit(2);
}

if (values.help) {
  console.log(`wishbusterz-rider — check an Astro site against baseline best practices

Usage:
  wishbusterz-rider                       Run every offline check in the current dir
  wishbusterz-rider -s seo -s images      Run only those domains
  wishbusterz-rider --url https://site    Also run live + lighthouse against a served site
  wishbusterz-rider --url … --strategy desktop   Lighthouse on desktop (default: mobile)
  wishbusterz-rider --url … --post /blog/x       Audit a specific page live
  wishbusterz-rider -s lighthouse --url https://site   Just the Lighthouse scorecard
  wishbusterz-rider --strict              Treat house-style baseline checks as required too
  wishbusterz-rider --json                Machine-readable output
  wishbusterz-rider --quiet               Print only findings (skip ✅ lines)

Offline domains: ${Object.keys(OFFLINE).join(', ')}
With --url:      live, lighthouse, browser
                 (lighthouse needs a free $PAGESPEED_API_KEY; browser needs
                  playwright installed — each skips cleanly without it)

Note: --url works from any directory — offline domains need an Astro project in cwd,
but a live/lighthouse run only needs the URL.

By default only universal Astro/SEO/perf practice is required. Checks that encode this
project's baseline (Cloudflare delivery, Orama search, RSS/llms.txt, view transitions)
report as 💡 [baseline] and don't fail the run — pass --strict to require them.

Outcomes:
  ✅  pass                    🔧  fix it (mechanical, required)
  🛑  needs a decision        💡  optional suggestion (not required)
  ⏭  skipped / not testable here

Exit 0 if clean (💡 suggestions don't count); 1 if any 🔧 or 🛑; 2 on tooling error.
`);
  process.exit(0);
}

// Validate -s before running anything. An unrecognised domain used to match no
// check and report "audit clean — exit 0", so a typo (or the natural guess
// `-s seo,images`) silently audited nothing and went green in CI forever.
const badDomains = (values.section ?? []).filter((s) => !ALL_DOMAINS.includes(s));
if (badDomains.length) {
  for (const bad of badDomains) {
    const hint = bad.includes(',')
      ? ` — pass one -s per domain: ${bad.split(',').filter(Boolean).map((d) => `-s ${d.trim()}`).join(' ')}`
      : nearest(bad) ? ` — did you mean '${nearest(bad)}'?` : '';
    console.error(`error: unknown domain '${bad}'${hint}`);
  }
  console.error(`valid domains: ${ALL_DOMAINS.join(', ')}`);
  process.exit(2);
}

if (values.strategy && !STRATEGIES.includes(values.strategy)) {
  console.error(`error: unknown --strategy '${values.strategy}' — valid: ${STRATEGIES.join(', ')}`);
  process.exit(2);
}

const project = await detectProject(process.cwd());
// Offline domains need an Astro project in cwd; a live/lighthouse run only needs --url.
if (!project && !values.url) {
  const offlineWanted = !values.section?.length || values.section.some((s) => s in OFFLINE);
  console.error(`error: ${process.cwd()} is not an Astro project (no astro.config.* and no "astro" dependency).`);
  if (offlineWanted) console.error('cd to the project root (the directory holding astro.config.*), or pass --url <site> to audit a served site from anywhere.');
  process.exit(2);
}

const reporter = new Reporter({ json: values.json, quiet: values.quiet, strict: values.strict });
const wanted = values.section?.length ? new Set(values.section) : null;

// Cheap edit-distance-free "did you mean": same first letter, or one is a prefix.
function nearest(input) {
  const s = input.toLowerCase();
  return ALL_DOMAINS.find((d) => d.startsWith(s) || s.startsWith(d) || d[0] === s[0]) ?? null;
}

// Offline domains (skip if cwd isn't an Astro project but a --url run was requested)
if (project) {
  const ctx = { project, reporter };
  for (const [name, loader] of Object.entries(OFFLINE)) {
    if (wanted && !wanted.has(name)) continue;
    try {
      const mod = await loader();
      await mod.run(ctx);
    } catch (err) {
      reporter.error(`${name} check crashed: ${err.message}`);
    }
  }
} else {
  reporter.skip('project', 'offline-domains', 'cwd is not an Astro project — running only the --url checks (cd into the site repo for the source domains)');
}

// URL-only domains
if (values.url) {
  reporter.source = 'live';
  const base = values.url.replace(/\/$/, '');
  const strategy = values.strategy ?? 'mobile';
  if (!wanted || wanted.has('live')) {
    try {
      const mod = await import('./checks/live.mjs');
      await mod.run({ base, reporter, post: values.post });
    } catch (err) {
      reporter.error(`live check crashed: ${err.message}`);
    }
  }
  if (!wanted || wanted.has('lighthouse')) {
    try {
      const mod = await import('./checks/lighthouse.mjs');
      await mod.run({ reporter, url: base, strategy });
    } catch (err) {
      reporter.error(`lighthouse check crashed: ${err.message}`);
    }
  }
  if (!wanted || wanted.has('browser')) {
    try {
      const mod = await import('./checks/browser.mjs');
      await mod.run({ reporter, url: base, post: values.post });
    } catch (err) {
      reporter.error(`browser check crashed: ${err.message}`);
    }
  }
} else if (wanted && URL_ONLY.some((d) => wanted.has(d))) {
  reporter.error(`${URL_ONLY.join('/')} checks need --url <base>`);
}

reporter.finish();
process.exit(reporter.exitCode());
