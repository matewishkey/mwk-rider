import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One collection, one schema. Every consumer — the blog index, the RSS feed,
// /llms.txt, the JSON-LD — reads validated fields, so a typo in frontmatter
// fails the build instead of shipping an empty <meta>.
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
    // 110–180 characters is roughly what a search result and a social card show
    // before truncating. Bounding it here means you find out while writing, not
    // after someone shares the link.
    excerpt: z.string().min(110).max(180),
    tags: z.array(z.string()).min(1).max(4),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
