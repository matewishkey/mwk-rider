// Detect whether cwd is an Astro project and load its key files.
// Returns null when it isn't (no astro.config.* and no "astro" dependency).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function detectProject(cwd) {
  const packageJson = readJsonIfExists(join(cwd, 'package.json'));
  const astroConfig = readFileIfExists(join(cwd, 'astro.config.mjs'))
                   ?? readFileIfExists(join(cwd, 'astro.config.ts'))
                   ?? readFileIfExists(join(cwd, 'astro.config.js'));

  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  if (astroConfig == null && deps.astro == null) return null;

  const project = {
    root: cwd,
    packageJson,
    astroConfig,
    tsconfig:    readJsonIfExists(join(cwd, 'tsconfig.json')),
    contentConfig: readFileIfExists(join(cwd, 'src', 'content.config.ts'))
                ?? readFileIfExists(join(cwd, 'src', 'content', 'config.ts')),
    hasDist: existsSync(join(cwd, 'dist')),
    ogConfig: null,
  };

  // Optional scripts/og.config.mjs carries brand info (mediaDomain, siteName…) if present.
  const ogConfigPath = join(cwd, 'scripts', 'og.config.mjs');
  if (existsSync(ogConfigPath)) {
    try {
      const mod = await import(pathToFileURL(ogConfigPath).href);
      project.ogConfig = mod.config ?? mod.default ?? null;
    } catch (err) {
      project.ogConfigError = err.message;
    }
  }

  // Identify locales from astro.config — gates the multi-locale variants of some checks
  project.locales = parseLocales(project.astroConfig);
  project.isMultiLocale = project.locales.length > 1;

  return project;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function readFileIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function parseLocales(astroConfig) {
  if (!astroConfig) return [];
  const m = astroConfig.match(/locales\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z]{2}(?:-[A-Z]{2})?)['"]/g)].map(r => r[1]);
}
