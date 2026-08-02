/**
 * Per-locale llms.txt per §18.8.
 * One file per locale, posts grouped by `type:`. Same filter predicate
 * as RSS + search-index (one expression, four discovery surfaces).
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { config as ogConfig } from '../../scripts/og.config.mjs';
import { urlSlug } from '../lib/slug';

export async function getStaticPaths() {
  const locales = ogConfig.brand.i18n?.locales ?? ['en'];
  return locales.map((locale) => ({ params: { locale } }));
}

export const GET: APIRoute = async ({ params }) => {
  const locale = params.locale!;
  const { brand } = ogConfig;
  const siteUrl = brand.siteUrl ?? '';
  const siteName = brand.siteName ?? 'Site';
  const tagline = brand.tagline ?? '';
  const defaultLocale = brand.i18n?.defaultLocale ?? 'en';

  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft && !p.data.previewOnly && p.data.locale === locale)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const byType = new Map<string, typeof posts>();
  for (const post of posts) {
    const type = post.data.type ?? 'posts';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(post);
  }

  const lines: string[] = [];
  lines.push(`# ${siteName} — ${locale.toUpperCase()}`);
  lines.push('');
  if (tagline) {
    lines.push(`> ${tagline}`);
    lines.push('');
  }
  lines.push(
    `LLM-friendly index of ${siteName} (locale: ${locale}). Posts grouped by type. ` +
    `Append \`.md\` to any URL for the raw markdown (per llmstxt.org convention).`
  );
  lines.push('');

  for (const [type, group] of byType) {
    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    lines.push('');
    for (const post of group) {
      const path = post.data.locale === defaultLocale
        ? `/blog/${urlSlug(post.id)}`
        : `/${post.data.locale}/blog/${urlSlug(post.id)}`;
      lines.push(`- [${post.data.title}](${siteUrl}${path}): ${post.data.excerpt}`);
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
