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
//   google      Search Console (verified + sitemap) + GA4 property + Zaraz wiring
//               (needs a Google service-account key; Zaraz leg needs $CLOUDFLARE_API_TOKEN)
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

const { values } = parseArgs({
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
});

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
With --url:      live, lighthouse, google
                 (lighthouse needs $PAGESPEED_API_KEY; google needs $GOOGLE_SERVICE_ACCOUNT_JSON
                  or $GOOGLE_APPLICATION_CREDENTIALS — each skips without its key)

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

const project = await detectProject(process.cwd());
// Offline domains need an Astro project in cwd; a live/lighthouse run only needs --url.
if (!project && !values.url) {
  console.error(`error: ${process.cwd()} is not an Astro project (no astro.config.* and no "astro" dependency). Pass --url <site> to audit a served site from anywhere.`);
  process.exit(2);
}

const reporter = new Reporter({ json: values.json, quiet: values.quiet, strict: values.strict });
const wanted = values.section?.length ? new Set(values.section) : null;

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
  if (!wanted || wanted.has('google')) {
    try {
      const mod = await import('./checks/google.mjs');
      await mod.run({ reporter, url: base });
    } catch (err) {
      reporter.error(`google check crashed: ${err.message}`);
    }
  }
} else if (wanted && (wanted.has('live') || wanted.has('lighthouse') || wanted.has('google'))) {
  reporter.error('live/lighthouse/google checks need --url <base>');
}

reporter.finish();
process.exit(reporter.exitCode());
