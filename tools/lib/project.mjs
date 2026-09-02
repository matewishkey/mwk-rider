// Detect whether cwd is an Astro project and load its key files.
// Returns null when it isn't (no astro.config.* and no "astro" dependency).
//
// SAFETY: this tool is pointed at projects you may not control, so it NEVER
// executes project code. Everything here is read as text and parsed. An earlier
// version `await import()`ed scripts/og.config.mjs, which ran whatever that file
// contained (top-level side effects, install scripts, anything) simply because
// you audited the directory. Config values are extracted with regexes instead:
// less precise, but auditing a repo must never be equivalent to running it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export async function detectProject(cwd) {
  const packageJsonRaw = readFileIfExists(join(cwd, 'package.json'));
  const packageJson = parseJson(packageJsonRaw);
  const astroConfig = readFirstFile(cwd, [
    'astro.config.mjs', 'astro.config.ts', 'astro.config.js',
    'astro.config.mts', 'astro.config.cjs', 'astro.config.cts',
  ]);

  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  if (astroConfig == null && deps.astro == null) return null;

  const tsconfigRaw = readFileIfExists(join(cwd, 'tsconfig.json'));

  const project = {
    root: cwd,
    packageJson,
    // Distinguishes "no package.json" from "package.json we couldn't parse", so
    // modules.mjs can say which — the second used to be reported as "missing".
    packageJsonMalformed: packageJsonRaw != null && packageJson == null,
    astroConfig,
    tsconfig: parseJson(tsconfigRaw),
    tsconfigMalformed: tsconfigRaw != null && parseJson(tsconfigRaw) == null,
    contentConfig: readFileIfExists(join(cwd, 'src', 'content.config.ts'))
                ?? readFileIfExists(join(cwd, 'src', 'content', 'config.ts')),
    hasDist: existsSync(join(cwd, 'dist')),
    // Is dist/ older than the source it was built from? Every dist-reading
    // check judges the build, and a build the source has moved past is a
    // different site — the audit said clean on one whose build was BROKEN,
    // because it read the dist/ the last good build left behind (#34).
    distStale: existsSync(join(cwd, 'dist')) ? staleDist(cwd) : null,
    ogConfig: null,
  };

  // Optional scripts/og.config.mjs carries brand info (mediaDomain, siteName…).
  // Read as text — see the SAFETY note above.
  const ogRaw = readFileIfExists(join(cwd, 'scripts', 'og.config.mjs'));
  if (ogRaw) project.ogConfig = parseOgConfig(ogRaw);

  return project;
}

/** Scrape the string-valued brand fields the checks actually consult. */
function parseOgConfig(src) {
  const out = {};
  for (const key of ['mediaDomain', 'siteName', 'siteUrl', 'tagline', 'authorName', 'authorUrl', 'twitterSite', 'twitterCreator']) {
    const m = src.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`));
    if (m && m[2].trim()) out[key] = m[2];
  }
  return Object.keys(out).length ? out : null;
}

function parseJson(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

function readFileIfExists(path) {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf8'); }
  catch { return null; }
}

function readFirstFile(cwd, names) {
  for (const n of names) {
    const t = readFileIfExists(join(cwd, n));
    if (t != null) return t;
  }
  return null;
}

/**
 * `{ src, dist }` newest mtimes when source is newer than the build, else null.
 *
 * Source is everything a build reads: src/, public/, scripts/, the config and
 * package.json. Not node_modules and not dist itself. Walks are bounded — a
 * few thousand stats — and never follow symlinks.
 */
function staleDist(cwd) {
  const src = Math.max(
    ...['src', 'public', 'scripts'].map((d) => newestMtime(join(cwd, d))),
    ...['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts', 'package.json']
      .map((f) => { try { return statSync(join(cwd, f)).mtimeMs; } catch { return 0; } }),
  );
  const dist = newestMtime(join(cwd, 'dist'));
  return src > dist ? { src, dist } : null;
}

function newestMtime(dir, budget = { n: 5000 }) {
  let newest = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (budget.n-- <= 0) break;
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (e.name !== 'node_modules') newest = Math.max(newest, newestMtime(full, budget)); continue; }
    try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* raced away */ }
  }
  return newest;
}
