import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The blog collection, multi-locale.
//
// Layout is src/data/blog/<locale>/<slug>.md, and entry.id KEEPS the locale
// prefix (e.g. "en/welcome") so ids stay unique across locales — two
// translations of one post share a slug and would otherwise collide. URL slugs
// strip the prefix through src/lib/slug.ts, which is the one place that
// conversion happens.
const blog = defineCollection({
  loader: glob({
    // `.md` AND `.mdx`. @astrojs/mdx is a baseline dependency, and a pattern of
    // '**/*.md' means an .mdx post is silently never loaded — the integration is
    // installed, required by the audit, and physically unusable. Measured: an
    // .mdx file added here produced no page and no error.
    pattern: '**/*.{md,mdx}',
    base: './src/data/blog',
    generateId: ({ entry }) => entry.replace(/\.mdx?$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    dateModified: z.coerce.date().optional(),
    tags: z.array(z.string()).min(2).max(4),
    excerpt: z.string().min(110).max(180),
    draft: z.boolean().default(false),
    type: z.enum(['thoughts', 'project']),
    ogImage: z.url().optional(),
    previewOnly: z.boolean().default(false),
    locale: z.enum(['en', 'hu']),
    translationKey: z.string().optional(),
  }),
});

export const collections = { blog };
