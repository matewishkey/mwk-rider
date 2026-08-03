/**
 * /llms.txt — the machine-readable index of what this site publishes.
 *
 * Built from the content store, so it cannot fall behind the site: add a post
 * and it appears here on the next build. Drafts are excluded by the same
 * predicate the blog index and the feed use.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/posts';
import { config as ogConfig } from '../../scripts/og.config.mjs';

const { brand } = ogConfig;

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog'))
    .filter(isPublished)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const lines = [
    `# ${brand.siteName}`,
    '',
    `> ${brand.tagline}`,
    '',
    '## Pages',
    '',
    `- [Home](${brand.siteUrl}/): ${brand.tagline}`,
    `- [About](${brand.siteUrl}/about): what this site is and who writes it`,
    `- [Contact](${brand.siteUrl}/contact): send a message`,
    `- [Media kit](${brand.siteUrl}/media-kit): logo, boilerplate and contact details`,
    '',
    '## Posts',
    '',
    ...posts.map((post) => `- [${post.data.title}](${brand.siteUrl}/blog/${post.id}): ${post.data.excerpt}`),
    '',
    '## Feeds',
    '',
    `- [RSS](${brand.siteUrl}/rss.xml)`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
