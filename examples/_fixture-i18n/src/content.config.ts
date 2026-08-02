import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Per contract §7 + §15.2 (dateModified optional) + §18.2 (locale + translationKey).
//
// Pattern B layout (§18.3): src/data/blog/<locale>/<slug>.md
// entry.id KEEPS the locale prefix (e.g. "en/welcome") so Content Layer
// IDs stay unique. URL slugs strip the prefix via src/lib/slug.ts.
// (Contract §18.3 currently prescribes stripping in generateId — that
// causes silent ID collisions; Phase 2 will fix the contract to match.)
const blog = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/data/blog',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
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
