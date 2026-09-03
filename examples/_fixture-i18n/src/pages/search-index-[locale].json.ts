/**
 * Per-locale search index: one document set per language, so a query never
 * returns results the reader cannot read.
 *
 * One persisted JSON per locale, served at /search-index-<locale>.json.
 * Uses native Orama `save()` (plain JSON object) instead of
 * @orama/plugin-data-persistence — the latter bundles dpack which has
 * Node-only code that breaks in the browser. Save/load on plain JSON
 * is universal, smaller bundle, and the contract gets the same
 * "build-time index → JSON over the wire → restore on client" shape.
 *
 * Schema and tokenizer config live in src/lib/search-schema.ts —
 * shared with the client so server/client agree on the wire format.
 *
 * Filter: !draft && !previewOnly && locale === current — the multi-locale
 * extension of the single canonical predicate shared with RSS / llms / sitemap.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { create, insertMultiple, save } from '@orama/orama';
import { config as ogConfig } from '../../scripts/og.config.mjs';
import { urlSlug } from '../lib/slug';
import { SEARCH_SCHEMA, tokenizerFor } from '../lib/search-schema';

export async function getStaticPaths() {
  const locales = ogConfig.brand.i18n?.locales ?? ['en'];
  return locales.map((locale) => ({ params: { locale } }));
}

export const GET: APIRoute = async ({ params }) => {
  const locale = params.locale!;
  const posts = await getCollection('blog');
  const indexed = posts
    .filter((p) => !p.data.draft && !p.data.previewOnly && p.data.locale === locale)
    .map((p) => ({
      slug: urlSlug(p.id),
      title: p.data.title,
      excerpt: p.data.excerpt,
      tags: p.data.tags ?? [],
      type: p.data.type,
      date: p.data.date.toISOString(),
      body: p.body ?? '',
    }));

  const db = create({
    schema: SEARCH_SCHEMA,
    components: { tokenizer: tokenizerFor(locale) },
  });

  await insertMultiple(db, indexed);
  const serialized = save(db);

  return new Response(JSON.stringify(serialized), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
