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
  schema: ({ image }) => z.object({
    title: z.string(),
    // The post's lead image, in one of two lanes:
    //   cover: ./cover.png                   — a file next to the post (or under
    //          src/assets/); Astro resizes it at build. The bootstrapping lane.
    //   cover: { key: 'blog/<id>/cover.jpg', width: 1600, height: 900 }
    //          — an object in the site's R2 bucket; Cloudflare transforms it at
    //          the edge and the build never touches the bytes. The production
    //          lane, once mediaDomain is set. `npm run media` prints this block.
    // width/height are required on the R2 form because the build cannot read
    // them from a file it never sees, and without them the image shifts layout.
    cover: z.union([
      image(),
      z.object({ key: z.string().regex(/^[\w./-]+$/), width: z.number().int().positive(), height: z.number().int().positive() }),
    ]).optional(),
    coverAlt: z.string().optional(),
    date: z.coerce.date(),
    dateModified: z.coerce.date().optional(),
    // 110–180 characters is roughly what a search result and a social card show
    // before truncating. Bounding it here means you find out while writing, not
    // after someone shares the link.
    excerpt: z.string().min(110).max(180),
    tags: z.array(z.string()).min(1).max(4),
    draft: z.boolean().default(false),
  }).refine((d) => !d.cover || !!d.coverAlt, { message: 'a cover needs coverAlt — an image with no alt is invisible to a screen reader and to search' }),
});

export const collections = { blog };
