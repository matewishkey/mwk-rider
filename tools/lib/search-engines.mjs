// search-engines — the one list of search libraries, shared by
// `modules:search:engine` (how many DISTINCT engines are installed) and
// `data:search:index` (does a site whose engine needs a local index feed it).
//
// Two checks reasoning about "does this site have search" from two different
// lists is how a site ends up told its search index is missing for a library
// the other check does not recognise. Hence one list — but a flat list of
// package names was still wrong twice, and both showed up on sites that were
// built CORRECTLY:
//
//   - **One engine ships as several packages.** `astro-pagefind` is the Astro
//     integration that wraps `pagefind`, and installing both is the documented
//     setup; `algoliasearch` + `@docsearch/js` are one product too. A flat list
//     counted each pair as "2 search engines installed — two indexes to build",
//     which is exactly backwards: they build one.
//   - **Not every engine has a local index to check.** Pagefind indexes the
//     BUILT HTML in dist/ at build time; Algolia, Meilisearch and Typesense
//     keep the index on a server. Demanding a `search-index.json` endpoint of
//     any of them is demanding a file the engine is designed not to have.
//
// So an engine is a family of packages plus one fact: does it need the site to
// emit its own index? Measured on a pagefind site and an Algolia site, both of
// which the flat list had reported two findings about.

/** The baseline's engine, when a site has search at all. */
export const BASELINE_SEARCH = '@orama/orama';

/**
 * Every search engine this tool recognises.
 *
 * `packages` is every npm name that means "this engine" — matching any one of
 * them is the engine, matching several is still ONE engine.
 * `localIndex` is whether the site itself has to emit the index the engine
 * reads. False means the engine builds it from the output, or hosts it.
 */
export const ENGINES = [
  { id: '@orama/orama', label: 'Orama',       packages: ['@orama/orama'], localIndex: true },
  { id: 'fuse.js',      label: 'Fuse.js',     packages: ['fuse.js'],      localIndex: true },
  { id: 'lunr',         label: 'Lunr',        packages: ['lunr'],         localIndex: true },
  { id: 'flexsearch',   label: 'FlexSearch',  packages: ['flexsearch'],   localIndex: true },
  { id: 'minisearch',   label: 'MiniSearch',  packages: ['minisearch'],   localIndex: true },
  { id: 'js-search',    label: 'js-search',   packages: ['js-search'],    localIndex: true },
  // Indexes the built HTML in dist/ as a build step — there is no endpoint to
  // write, and asking for one is asking the site to duplicate the build.
  { id: 'pagefind',     label: 'Pagefind',    packages: ['pagefind', 'astro-pagefind'], localIndex: false },
  // Hosted indexes. The site ships a client and credentials, not an index.
  { id: 'algolia',      label: 'Algolia',     packages: ['algoliasearch', '@algolia/client-search', '@docsearch/js'], localIndex: false },
  { id: 'meilisearch',  label: 'Meilisearch', packages: ['meilisearch'],  localIndex: false },
  { id: 'typesense',    label: 'Typesense',   packages: ['typesense'],    localIndex: false },
];

/**
 * Which engines a package.json installs, in list order.
 *
 * Each result carries `installed`: the packages that actually matched, so a
 * finding can name what it saw rather than the family label alone.
 */
export function installedEngines(packageJson) {
  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  return ENGINES
    .map((e) => ({ ...e, installed: e.packages.filter((p) => deps[p]) }))
    .filter((e) => e.installed.length > 0);
}

/** An engine named for a human: the family, and the packages if there are several. */
export const describeEngine = (e) =>
  e.installed.length > 1 ? `${e.label} (${e.installed.join(' + ')})` : e.installed[0];
