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
import { configString } from './config-string.mjs';

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
    // `{ src, dist }` when stale, `{ truncated: true }` when the walk could not
    // see enough to be sure, `null` when the build is current.
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
    const value = configString(src, key);
    if (value && value.trim()) out[key] = value;
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
 * Whether `dist/` predates the source it was built from.
 *
 * Source is everything a build reads: src/, public/, scripts/, the config and
 * package.json. Not node_modules and not dist itself. Walks are bounded and
 * never follow symlinks.
 *
 * Two things this deliberately does NOT do:
 *
 *   - **Decide on a millisecond.** `git clone`, `git checkout` and `git stash
 *     pop` stamp source and build files at effectively the same instant, and a
 *     strict `>` then picked a winner from sub-millisecond ordering — the "changed
 *     under a minute after the last build" message was the tell. Anything inside
 *     GRACE_MS is the same moment.
 *   - **Guess when it could not look.** If either walk hit its budget the newest
 *     mtime is a lower bound, and truncation can only ever bias toward "stale",
 *     so the caller is told it could not be determined instead.
 */
const GRACE_MS = 2000;

function staleDist(cwd) {
  const configs = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js',
    'astro.config.mts', 'astro.config.cjs', 'astro.config.cts', 'package.json'];
  const srcWalks = ['src', 'public', 'scripts'].map((d) => newestMtime(join(cwd, d)));
  const src = Math.max(
    ...srcWalks.map((w) => w.newest),
    ...configs.map((f) => { try { return statSync(join(cwd, f)).mtimeMs; } catch { return 0; } }),
  );
  // dist/ gets the larger budget: an adapter build emits thousands of chunks
  // under dist/_worker.js/ before dist/client/ is reached.
  const distWalk = newestMtime(join(cwd, 'dist'), { n: 40000 });
  if (distWalk.truncated || srcWalks.some((w) => w.truncated)) return { truncated: true };
  if (src <= distWalk.newest + GRACE_MS) return null;
  return { src, dist: distWalk.newest };
}

/** `{ newest, truncated }` for a bounded, symlink-skipping walk. */
function newestMtime(dir, budget = { n: 5000 }) {
  let newest = 0;
  let truncated = false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return { newest: 0, truncated: false }; }
  for (const e of entries) {
    if (budget.n-- <= 0) { truncated = true; break; }
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      const sub = newestMtime(full, budget);
      newest = Math.max(newest, sub.newest);
      truncated ||= sub.truncated;
      continue;
    }
    try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* raced away */ }
  }
  return { newest, truncated };
}
