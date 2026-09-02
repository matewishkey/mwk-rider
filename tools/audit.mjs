#!/usr/bin/env node
// rider — check an Astro site against baseline best practices.
//
// Seven offline domains read source + dist:
//   modules   expected baseline integrations + config are present and wired
//   seo       canonical, title/description, OG meta, sitemap
//   images    content images routed through a transform + not oversized
//   perf      immutable cache headers for hashed assets + no-CLS <img>
//   data      machine-readable surface: JSON-LD, /llms.txt, RSS
//   analytics what delivers analytics (Cloudflare Web Analytics by default),
//             and no hardcoded Google Analytics/GTM snippet firing pre-consent
//   content   pages a site is repeatedly asked for: a media kit, a design reference
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
  content: () => import('./checks/content.mjs'),
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
      verbose:  { type: 'boolean' },
      rules:    { type: 'boolean' },
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
  console.log(`rider — check an Astro site against baseline best practices

Usage:
  rider                       Run every offline check in the current dir
  rider -s seo -s images      Run only those domains
  rider --url https://example.com    Also run live + lighthouse against a served site
  rider --url … --strategy desktop   Lighthouse + browser at desktop width (default: mobile)
  rider --url … --post /blog/x       Audit a specific page live
  rider -s lighthouse --url https://example.com   Just the Lighthouse scorecard
  rider --strict              Treat house-style baseline checks as required too
  rider --json                Machine-readable output
  rider --quiet               Hide the ✅ lines (findings, 💡 and ⏭ still print)
  rider --verbose             Show them even when output is piped or $CI is set
  rider --rules --json        Every rule id, severity, mode and why; runs nothing

Offline domains: ${Object.keys(OFFLINE).join(', ')}
With --url:      live, lighthouse, browser
                 (lighthouse needs a free $PAGESPEED_API_KEY; browser needs
                  playwright installed — each skips cleanly without it)

Note: --url works from any directory — offline domains need an Astro project in cwd,
but a live/lighthouse run only needs the URL.

By default only universal Astro/SEO/perf practice is required. Checks that encode this
project's baseline (Cloudflare delivery, RSS/llms.txt, view transitions) report as
💡 [baseline] and don't fail the run — pass --strict to require them.

Search is optional, and so is analytics: "analytics: provider" reports what delivers
analytics (Cloudflare Web Analytics by default — free, cookieless, no consent banner;
Zaraz when you need a tag manager) and never fails a run, in either mode.

Outcomes:
  ✅  pass                    🔧  fix it (mechanical, required)
  🛑  needs a decision        💡  optional suggestion (not required)
  ⏭  skipped / not testable here

Exit 0 if clean (💡 suggestions don't count); 1 if any 🔧 or 🛑; 2 on tooling error.
`);
  process.exit(0);
}

// --rules answers "what does this tool check, and which of it binds me?" from
// the tool itself rather than from docs that can drift. It runs nothing, so it
// works anywhere — no Astro project, no network.
if (values.rules) {
  const { ruleCatalogue } = await import('./lib/rules.mjs');
  const catalogue = ruleCatalogue();
  if (values.json) {
    console.log(JSON.stringify({ rules: catalogue }));
  } else {
    const LABEL = { house: '[baseline] ', advisory: '[advisory] ', universal: '[universal]' };
    for (const r of catalogue) console.log(`${LABEL[r.severity]} ${r.id} — ${r.why}`);
    console.log(`\n${catalogue.length} rules. [universal] is required by default; [baseline] reports 💡 unless --strict; [advisory] reports 💡 in every mode.`);
  }
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

// A clean run spends thousands of characters saying nothing is wrong. That's
// fine for a human reading a terminal and pure cost for an agent, so passes are
// hidden by default whenever nobody is watching a TTY. --verbose brings them
// back; --quiet forces them off even on a terminal.
const machineReader = !process.stdout.isTTY || !!process.env.CI || !!process.env.CLAUDECODE;
const quiet = values.verbose ? false : (values.quiet || machineReader);

const reporter = new Reporter({ json: values.json, quiet, strict: values.strict });
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
      // `project` may be null (--url from anywhere). live.mjs uses it only to
      // tell a broken cache config from a local server that ignores _headers.
      await mod.run({ base, reporter, post: values.post, project });
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
      await mod.run({ reporter, url: base, post: values.post, strategy });
    } catch (err) {
      reporter.error(`browser check crashed: ${err.message}`);
    }
  }
} else if (wanted && URL_ONLY.some((d) => wanted.has(d))) {
  reporter.error(`${URL_ONLY.join('/')} checks need --url <base>`);
}

reporter.finish();
process.exit(reporter.exitCode());
