/**
 * Root /llms.txt — index pointing at per-locale variants per.
 * Lists the default locale's posts inline (for crawlers that don't follow
 * links), then links to each per-locale variant.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { config as ogConfig } from '../../scripts/og.config.mjs';
import { urlSlug } from '../lib/slug';

export const GET: APIRoute = async () => {
  const { brand } = ogConfig;
  const siteUrl = brand.siteUrl ?? '';
  const siteName = brand.siteName ?? 'Site';
  const tagline = brand.tagline ?? '';
  const locales = brand.i18n?.locales ?? ['en'];
  const defaultLocale = brand.i18n?.defaultLocale ?? 'en';

  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft && !p.data.previewOnly && p.data.locale === defaultLocale)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const lines: string[] = [];
  lines.push(`# ${siteName}`);
  lines.push('');
  if (tagline) {
    lines.push(`> ${tagline}`);
    lines.push('');
  }
  lines.push(`Multi-locale site (locales: ${locales.join(', ')}). Per-locale indexes:`);
  lines.push('');
  for (const locale of locales) {
    lines.push(`- [llms-${locale}.txt](${siteUrl}/llms-${locale}.txt) — ${locale.toUpperCase()} posts`);
  }
  lines.push('');
  lines.push(`## Default locale (${defaultLocale}) — posts inline`);
  lines.push('');

  const byType = new Map<string, typeof posts>();
  for (const post of posts) {
    const type = post.data.type ?? 'posts';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(post);
  }
  for (const [type, group] of byType) {
    lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    lines.push('');
    for (const post of group) {
      lines.push(`- [${post.data.title}](${siteUrl}/blog/${urlSlug(post.id)}): ${post.data.excerpt}`);
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
