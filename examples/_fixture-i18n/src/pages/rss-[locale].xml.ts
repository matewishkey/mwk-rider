/**
 * Per-locale RSS feed per §18.7.
 * One feed per locale, filtered by locale. URLs respect prefixDefaultLocale:false.
 */
import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { config as ogConfig } from '../../scripts/og.config.mjs';
import { urlSlug } from '../lib/slug';

export async function getStaticPaths() {
  const locales = ogConfig.brand.i18n?.locales ?? ['en'];
  return locales.map((locale) => ({ params: { locale } }));
}

export const GET: APIRoute = async ({ params, site }) => {
  const locale = params.locale!;
  const { brand } = ogConfig;
  const defaultLocale = brand.i18n?.defaultLocale ?? 'en';
  const localeMap: Record<string, string> = brand.i18n?.localeMap ?? { en: 'en-US' };

  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft && !p.data.previewOnly && p.data.locale === locale)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: `${brand.siteName} — ${locale.toUpperCase()}`,
    description: brand.tagline ?? '',
    site: site ?? brand.siteUrl ?? 'http://localhost:4321',
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.excerpt,
      link: p.data.locale === defaultLocale
        ? `/blog/${urlSlug(p.id)}`
        : `/${p.data.locale}/blog/${urlSlug(p.id)}`,
    })),
    customData: `<language>${localeMap[locale] ?? locale}</language>`,
  });
};
