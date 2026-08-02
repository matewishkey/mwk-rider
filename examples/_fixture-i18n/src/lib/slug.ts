/**
 * Multi-locale slug helper.
 *
 * The Content Layer requires entry IDs to be unique within a collection.
 * Pattern B (locale subdirectories — §18.3) puts a post like `welcome` at
 * both `src/data/blog/en/welcome.md` and `src/data/blog/hu/welcome.md`.
 * If generateId strips the locale prefix, the IDs collide and Astro
 * silently drops one entry. So entry.id MUST keep the locale prefix
 * (e.g. "en/welcome"), and URL routes compute the locale-neutral slug
 * separately via this helper.
 *
 * Contract Phase 2: §18.3 needs updating to reflect this fix.
 */
export function urlSlug(id: string): string {
  return id.replace(/^[a-z]{2}\//, '');
}
