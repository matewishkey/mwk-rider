// modules — the baseline Astro stack: version, integrations, and core config.
// Assumes the site is meant to be on the standard baseline and checks it's there
// and wired correctly (it does not try to set anything up).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_SEARCH, installedEngines } from '../lib/search-engines.mjs';

const SEC = 'modules';

// Baseline integrations every managed site is expected to carry.
//
// astro-robots-txt is deliberately NOT here: what matters is that the build
// ships a robots.txt pointing at the sitemap, and a generated endpoint does that
// at least as well (see seo:robots, which reads dist/robots.txt).
//
// @orama/orama is deliberately NOT here either, as of the 2026-08-03 baseline
// shift. Search is now optional: most content sites are small enough that the
// browser's own find-in-page beats a bundled index, and requiring the dependency
// gave every searchless site a `dep:` finding for choosing not to have a
// feature. What still binds is coherence — see `search:engine` below and
// `data:search:index`, which fires when a search library ships with nothing to
// feed it.
const BASELINE_DEPS = [
  '@astrojs/mdx',
  '@astrojs/sitemap',
  '@astrojs/rss',
  '@astrojs/check',
];

// The engine list lives in lib/search-engines.mjs — data:search:index reasons
// about the same set, and two lists is how they disagree.

// Experimental flags Astro 7 stabilized — still present under `experimental:`
// they are config errors, not no-ops. Each maps to its v7 home.
// (docs.astro.build/en/guides/upgrade-to/v7 — verified 2026-08-01)
const STABILIZED_EXPERIMENTAL = {
  logger:          'moved to top-level `logger`',
  cache:           'moved to top-level `cache`',
  routeRules:      'moved to top-level `routeRules`',
  queuedRendering: 'now the default — drop the flag',
  rustCompiler:    'now the only compiler — drop the flag',
  advancedRouting: 'on by default — drop the flag',
};

// `astro:transitions` internals removed in v7 — use the lifecycle event names.
const REMOVED_TRANSITION_APIS = [
  'TRANSITION_BEFORE_PREPARATION', 'TRANSITION_AFTER_PREPARATION',
  'TRANSITION_BEFORE_SWAP', 'TRANSITION_AFTER_SWAP', 'TRANSITION_PAGE_LOAD',
  'isTransitionBeforePreparationEvent', 'isTransitionBeforeSwapEvent',
  'createAnimationScope',
];

export async function run({ project, reporter }) {
  const pkg = project.packageJson;
  if (!pkg) {
    if (project.packageJsonMalformed) {
      reporter.block(SEC, 'package.json', 'present but not valid JSON — every dependency check is skipped', 'fix the JSON syntax (a trailing comma or comment will do it)');
    } else {
      reporter.block(SEC, 'package.json', 'missing at project root', 'create package.json');
    }
    return;
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // astro ^7+ (compare major.minor numerically so 7.10+ and 8+ pass)
  const astroVer = deps.astro;
  if (!astroVer) {
    reporter.block(SEC, 'astro:installed', 'not in dependencies', 'npm i astro@latest');
  } else if (!atLeast(astroVer, 7)) {
    reporter.fix(SEC, 'astro:version', `${astroVer} (baseline is ^7+)`, 'npx @astrojs/upgrade — then walk docs.astro.build/en/guides/upgrade-to/v7 (Rust compiler, Sätteri markdown, Vite 8, compressHTML: "jsx")');
  } else {
    reporter.pass(SEC, 'astro:version', astroVer);
  }

  // engines.node >= 22.12.0 — Astro 7's own engines floor
  const nodeEng = pkg.engines?.node;
  if (!atLeast(nodeEng, 22, 12)) {
    reporter.fix(SEC, 'engines.node', `${nodeEng ?? 'unset'} (need >= 22.12.0, Astro 7's floor)`, 'set "engines.node" to ">=22.12.0" in package.json');
  } else {
    reporter.pass(SEC, 'engines.node', nodeEng);
  }

  // TypeScript major must stay within what @astrojs/check peers on (^5 || ^6).
  // TS 7 is published as `latest` but breaks `astro check` today.
  const tsVer = deps.typescript;
  if (tsVer && deps['@astrojs/check'] && majorOf(tsVer) >= 7) {
    reporter.fix(SEC, 'typescript:version', `${tsVer} — @astrojs/check peers on typescript ^5 || ^6, so \`astro check\` breaks on 7`, 'pin typescript to ^6 until @astrojs/check declares TS 7 support');
  } else if (tsVer) {
    reporter.pass(SEC, 'typescript:version', tsVer);
  }

  // Baseline integrations present
  for (const dep of BASELINE_DEPS) {
    // One rule ("a baseline integration is missing"), many packages — so the id
    // is fixed and the package stays in the name. Deriving it per package would
    // mint a new "rule" for every dependency we ever add.
    if (deps[dep]) reporter.pass(SEC, `dep:${dep}`, deps[dep], { id: 'modules/dep' });
    else           reporter.fix(SEC, `dep:${dep}`, 'not installed', `npm i ${dep}`, { id: 'modules/dep' });
  }

  // Search: optional, but coherent.
  //
  // This used to demand Orama and flag anything else. That is house style being
  // asserted as a defect — a site with Pagefind has search, and it works. What
  // is a genuine defect is *two* client-side search engines: two indexes to
  // build, two bundles to ship, and two different answers to the same query.
  //
  // So: none is fine, one is fine, two is a finding.
  const engines = installedEngines(pkg);
  if (engines.length === 0) {
    reporter.skip(SEC, 'search:engine', 'no search library installed — search is optional in the baseline, so there is nothing to check here (data:search:index checks that a site which HAS one also feeds it)');
  } else if (engines.length > 1) {
    reporter.fix(SEC, 'search:engine', `${engines.length} search engines installed: ${engines.join(', ')} — two indexes to build, two bundles to ship, and two answers to the same query`, `pick one and drop the rest (the baseline's is ${BASELINE_SEARCH}, but any single client-side engine is fine)`);
  } else if (engines[0] === BASELINE_SEARCH) {
    reporter.pass(SEC, 'search:engine', 'Orama');
  } else {
    reporter.suggest(SEC, 'search:engine', `search is ${engines[0]}`, `a single client-side search engine is fine — the baseline happens to use ${BASELINE_SEARCH}, so only reach for it if you want the shared index-endpoint shape too`);
  }

  // @astrojs/cloudflare adapter is needed for <Image> only under SSR. On a static
  // build, <Image> is optimized at build time by Sharp and emitted to dist/ — no
  // adapter exists or is needed. A Cloudflare image service only matters for
  // on-demand (output: 'server') rendering, where Sharp can't run on Workers.
  const usesImageComponent = await grepSrc(project.root, /<Image[\s/>]/);
  const hasAdapter = !!deps['@astrojs/cloudflare'];
  const isSSR = /output\s*:\s*['"]server['"]/.test(project.astroConfig ?? '');
  if (!usesImageComponent) {
    reporter.pass(SEC, 'adapter:cloudflare', hasAdapter ? 'present (no <Image> usage detected)' : 'absent, no <Image> usage');
  } else if (!isSSR) {
    reporter.pass(SEC, 'adapter:cloudflare', '<Image> optimized at build time by Sharp (static output) — no adapter needed');
  } else if (hasAdapter) {
    reporter.pass(SEC, 'adapter:cloudflare', 'present, backs runtime <Image> under SSR');
  } else {
    reporter.block(SEC, 'adapter:cloudflare', 'SSR (output: "server") uses <Image> but @astrojs/cloudflare not installed', "npm i @astrojs/cloudflare (its image service backs runtime <Image> where Sharp can't run), or prerender the routes that use <Image>");
  }

  // astro.config assertions
  const cfg = project.astroConfig;
  if (!cfg) {
    reporter.block(SEC, 'astro.config', 'missing', 'create astro.config.mjs');
    return;
  }
  // `output` defaults to 'static' (Astro configuration reference, verified
  // 2026-08-02), so omitting it is correct — it was a required finding for
  // writing less config than necessary. Only an explicit 'server' is a
  // departure from the baseline, and even that is a legitimate choice.
  if (/output\s*:\s*['"]server['"]/.test(cfg)) {
    reporter.fix(SEC, 'output:static', "output: 'server' — the baseline is a fully static build", "set output: 'static' (or drop the option, since static is Astro's default) unless this site genuinely needs on-demand rendering");
  } else if (/output\s*:\s*['"]static['"]/.test(cfg)) {
    reporter.pass(SEC, 'output:static', 'explicit');
  } else {
    reporter.pass(SEC, 'output:static', "not set — static is Astro's default");
  }

  // --- Astro 7 migration residue -------------------------------------------
  // Things that were valid on 6 and are errors (or silently wrong) on 7.

  // Experimental flags v7 stabilized — still under `experimental:` they throw.
  const experimental = extractBlock(cfg, 'experimental');
  const stale = experimental
    ? Object.keys(STABILIZED_EXPERIMENTAL).filter((k) => new RegExp(`\\b${k}\\s*:`).test(experimental))
    : [];
  if (stale.length === 0) {
    reporter.pass(SEC, 'astro7:experimental', 'no stabilized flags left under experimental');
  } else {
    reporter.fix(
      SEC,
      'astro7:experimental',
      `experimental.${stale.join(', experimental.')} — stabilized in Astro 7`,
      stale.map((k) => `${k}: ${STABILIZED_EXPERIMENTAL[k]}`).join('; '),
    );
  }

  // Markdown: v7 renders with Sätteri and no longer installs @astrojs/markdown-remark.
  // The deprecated unified() options still work, but only with that package present.
  const md = extractBlock(cfg, 'markdown');
  const unifiedOpts = md
    ? ['remarkPlugins', 'rehypePlugins', 'remarkRehype'].filter((k) => new RegExp(`\\b${k}\\s*:`).test(md))
    : [];
  if (unifiedOpts.length === 0) {
    reporter.pass(SEC, 'astro7:markdown', 'no unified()-only markdown options (Sätteri default)');
  } else if (deps['@astrojs/markdown-remark']) {
    reporter.pass(SEC, 'astro7:markdown', `${unifiedOpts.join(', ')} backed by @astrojs/markdown-remark`);
  } else {
    reporter.fix(
      SEC,
      'astro7:markdown',
      `markdown.${unifiedOpts.join(', markdown.')} configured but @astrojs/markdown-remark is not installed (Astro 7 defaults to Sätteri and no longer ships it)`,
      'either port the plugins to Sätteri MDAST/HAST plugins, or npm i @astrojs/markdown-remark and set markdown.processor: unified()',
    );
  }

  // @astrojs/db was removed in v7 and is no longer maintained.
  if (deps['@astrojs/db']) {
    reporter.fix(SEC, 'astro7:db', '@astrojs/db installed — the package was removed in Astro 7', 'migrate to node:sqlite, Drizzle, or a hosted DB (Turso/Neon/PlanetScale) and drop the dep');
  } else {
    reporter.pass(SEC, 'astro7:db', 'not installed');
  }

  // astro:transitions internals removed in v7 — lifecycle event names replace them.
  const usedInternals = await collectSrc(
    project.root,
    new RegExp(`\\b(${REMOVED_TRANSITION_APIS.join('|')})\\b`, 'g'),
  );
  if (usedInternals.length === 0) {
    reporter.pass(SEC, 'astro7:transitions', 'no removed astro:transitions internals');
  } else {
    reporter.fix(
      SEC,
      'astro7:transitions',
      `removed astro:transitions API in use: ${usedInternals.join(', ')}`,
      "use the lifecycle event names directly ('astro:before-preparation', 'astro:after-swap', …)",
    );
  }

  // tsconfig strict
  if (project.tsconfig) {
    const ext = project.tsconfig.extends;
    const strict = typeof ext === 'string'
      ? ext.includes('astro/tsconfigs/strict')
      : Array.isArray(ext) && ext.some((e) => e.includes('astro/tsconfigs/strict'));
    if (strict) reporter.pass(SEC, 'tsconfig:strict');
    else reporter.fix(SEC, 'tsconfig:strict', `extends "${ext ?? 'nothing'}"`, 'extend "astro/tsconfigs/strict" in tsconfig.json');
  } else {
    reporter.fix(SEC, 'tsconfig:strict', 'tsconfig.json missing', 'create tsconfig.json extending astro/tsconfigs/strict');
  }

  // <ClientRouter /> in the root layout (view transitions)
  const rootLayout = [
    'src/layouts/RootLayout.astro',
    'src/layouts/Layout.astro',
    'src/layouts/BaseLayout.astro',
  ].find((p) => existsSync(join(project.root, p)));
  if (rootLayout) {
    const txt = readFileSync(join(project.root, rootLayout), 'utf8');
    if (/<ClientRouter\s*\/?>/.test(txt)) reporter.pass(SEC, 'ClientRouter', rootLayout);
    else reporter.fix(SEC, 'ClientRouter', `not in ${rootLayout}`, 'insert <ClientRouter /> into the layout <head>');
  }

  // Custom 404
  if (existsSync(join(project.root, 'src/pages/404.astro'))) {
    reporter.pass(SEC, '404:custom');
  } else {
    reporter.fix(SEC, '404:custom', 'src/pages/404.astro missing', 'create a branded 404 page');
  }

  // Fonts: Astro has a first-party fonts API (config `fonts:` + <Font> from
  // astro:assets) that self-hosts, generates fallback metrics to stop the swap
  // shifting layout, and emits preload links. A third-party font CDN costs an
  // extra connection on the critical path and leaks visitor IPs to that host.
  const fontCdn = await collectSrc(
    project.root,
    /(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net)/g,
  );
  const hasFontsConfig = /\bfonts\s*:\s*\[/.test(cfg);
  if (fontCdn.length > 0 && !hasFontsConfig) {
    reporter.fix(SEC, 'fonts', `webfonts loaded from ${fontCdn.join(', ')} — an extra connection on the critical path, and no fallback metrics (font swap shifts layout)`, "move to Astro's built-in fonts API: `fonts: [{ provider: fontProviders.google(), name: '…', cssVariable: '--font-…' }]` in astro.config, then <Font cssVariable=\"--font-…\" preload /> from astro:assets");
  } else if (hasFontsConfig) {
    reporter.pass(SEC, 'fonts', 'astro:fonts configured (self-hosted, with fallback metrics)');
  } else {
    reporter.skip(SEC, 'fonts', 'no third-party font CDN referenced in src/ — this check only looks for that; perf:font:* measures the fonts actually shipped in dist/');
  }

  // image.remotePatterns includes the media domain (only checkable if og.config declares one)
  const mediaDomain = project.ogConfig?.mediaDomain ?? project.ogConfig?.brand?.mediaDomain;
  if (mediaDomain) {
    const escaped = mediaDomain.replace(/\./g, '\\.');
    if (new RegExp(escaped).test(cfg)) {
      reporter.pass(SEC, 'remotePatterns', mediaDomain);
    } else {
      reporter.fix(SEC, 'remotePatterns', `${mediaDomain} not in image.remotePatterns`, `add { protocol: 'https', hostname: '${mediaDomain}' } to image.remotePatterns`);
    }
  }
}

// Does a version/range string satisfy a minimum major(.minor)? Reads the first
// major.minor in the string (handles `^6.10.0`, `>=22`, `~6.3`, `24.x`) and
// compares numerically — so two-digit minors (6.10) and future majors (7+) pass.
function atLeast(range, minMajor, minMinor = 0) {
  if (!range) return false;
  // Non-numeric specifiers carry no version to compare (`latest`, `workspace:*`,
  // `catalog:`, a git URL). Treat them as satisfied rather than inventing a
  // failure — the tool can't know, and a false 🔧 is worse than a missed nudge.
  if (!/\d/.test(range)) return true;
  // An OR'd range passes if ANY branch does: `^6 || ^7` satisfies a 7 floor.
  return range.split('||').some((branch) => {
    const m = branch.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return false;
    const major = Number(m[1]);
    // `22.x` / `7.*` — an unpinned minor can be anything at or above 0.
    const minorRaw = m[2];
    const minor = minorRaw == null ? (/^\s*[~^]?\d+\s*$|\.[x*]/.test(branch) ? Infinity : 0) : Number(minorRaw);
    return major > minMajor || (major === minMajor && minor >= minMinor);
  });
}

// Leading major of a version/range string (`^6.0.3` → 6, `>=22.12.0` → 22).
function majorOf(range) {
  const m = String(range ?? '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// Pull the body of a top-level `<key>: { … }` block out of a config source,
// brace-matched so nested objects don't truncate it. Returns null if absent.
// Text-level, like every other assertion here — the tool never imports a
// project's config (it may reference deps that aren't installed).
function extractBlock(src, key) {
  // Strip comments first: `// experimental: { rustCompiler: true }` left behind
  // after a migration is a note to self, not live config, and flagging it makes
  // the tool wrong exactly when someone is doing the upgrade it asks for.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const open = src.search(new RegExp(`\\b${key}\\s*:\\s*\\{`));
  if (open === -1) return null;
  const start = src.indexOf('{', open);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start + 1, i);
  }
  return null;
}

async function grepSrc(root, regex) {
  const src = join(root, 'src');
  if (!existsSync(src)) return false;
  for (const file of walkSrc(src)) {
    try { if (regex.test(readFileSync(file, 'utf8'))) return true; }
    catch {}
  }
  return false;
}

// Every distinct capture of `regex` (global, one capture group) across src/.
async function collectSrc(root, regex) {
  const src = join(root, 'src');
  if (!existsSync(src)) return [];
  const hits = new Set();
  for (const file of walkSrc(src)) {
    let txt;
    try { txt = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(regex)) hits.add(m[1] ?? m[0]);
  }
  return [...hits];
}

function* walkSrc(src) {
  const stack = [src];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.(astro|tsx?|jsx?|mdx?)$/.test(e.name)) yield full;
    }
  }
}
