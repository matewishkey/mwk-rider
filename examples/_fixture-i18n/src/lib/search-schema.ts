/**
 * Shared Orama schema + tokenizer config.
 *
 * Used by both the per-locale search-index build endpoint AND the
 * client-side SearchBox component. Shared because Orama's `load()`
 * requires the same schema on the consumer side that produced the index
 * — drift between server and client = silent restore failure.
 *
 * Skips @orama/plugin-data-persistence (which pulls dpack — has Node-only
 * code that breaks in the browser at runtime). Native save/load just emit
 * plain JSON-serializable objects; we wrap them in JSON.stringify for
 * transport.
 */
import { stemmer as hungarianStemmer } from '@orama/stemmers/hungarian';

/**
 * Schema gotcha (Orama v3):
 *   - 'string' / 'string[]' → fulltext indexed for BM25 search
 *   - 'enum'   / 'enum[]'   → filterable for `where` clauses (in/nin/eq,
 *                              containsAny/containsAll); NOT BM25-ranked
 *
 * For low-cardinality categorical data (type, tags) we want filter
 * semantics, not fulltext. Use `enum` / `enum[]` — Orama's `where` will
 * silently return zero results if you try `{ in: [...] }` on a plain
 * `string` field.
 */
export const SEARCH_SCHEMA = {
  slug: 'string',
  title: 'string',
  excerpt: 'string',
  tags: 'enum[]',
  type: 'enum',
  date: 'string',
  body: 'string',
} as const;

export function tokenizerFor(locale: string) {
  if (locale === 'hu') {
    return { language: 'hungarian', stemmer: hungarianStemmer, stemming: true };
  }
  return { language: 'english', stemming: true };
}
