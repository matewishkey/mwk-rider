// Detect whether cwd is an Astro project and load its key files.
// Returns null when it isn't (no astro.config.* and no "astro" dependency).
//
// SAFETY: this tool is pointed at projects you may not control, so it NEVER
// executes project code. Everything here is read as text and parsed. An earlier
// version `await import()`ed scripts/og.config.mjs, which ran whatever that file
// contained (top-level side effects, install scripts, anything) simply because
// you audited the directory. Config values are extracted with regexes instead:
// less precise, but auditing a repo must never be equivalent to running it.

import { existsSync, readFileSync } from 'node:fs';
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
