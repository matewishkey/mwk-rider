/**
 * The (locale, slug) pairs that get a social card — the preview shelf reads it
 * to list them. Translations are NOT deduplicated: each locale gets its own card.
 * Returns one entry per (locale, slug) pair — translations are NOT deduplicated.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { urlSlug } from '../../../lib/slug';

export const GET: APIRoute = async () => {
  const posts = await getCollection('blog');
  const list = posts
    .filter((p) => !p.data.draft && !p.data.previewOnly)
    .map((p) => ({
      slug: urlSlug(p.id),
      locale: p.data.locale,
      title: p.data.title,
      ogImage: p.data.ogImage ?? null,
    }));
  return new Response(JSON.stringify(list), {
    headers: { 'Content-Type': 'application/json' },
  });
};
