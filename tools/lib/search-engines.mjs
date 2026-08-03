// search-engines — the one list of client-side search libraries, shared by
// `modules:search:engine` (how many are installed) and `data:search:index`
// (does the site that has one also feed it).
//
// Two checks reasoning about "does this site have search" from two different
// lists is how a site ends up told its search index is missing for a library
// the other check does not recognise.

/** The baseline's engine, when a site has search at all. */
export const BASELINE_SEARCH = '@orama/orama';

/** Other client-side search libraries. Not wrong — just not the baseline. */
export const OTHER_SEARCH = [
  'fuse.js', 'lunr', 'flexsearch', 'minisearch', 'js-search',
  'algoliasearch', '@algolia/client-search', 'meilisearch', 'typesense',
  'pagefind', 'astro-pagefind', '@docsearch/js',
];

export const ALL_SEARCH = [BASELINE_SEARCH, ...OTHER_SEARCH];

/** Which search engines a package.json actually installs, in list order. */
export function installedEngines(packageJson) {
  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  return ALL_SEARCH.filter((d) => deps[d]);
}
