/**
 * JSON-LD builders extended for multi-locale+.
 * Adds inLanguage to BlogPosting when the site is multi-locale.
 */
import type { CollectionEntry } from 'astro:content';

interface BrandShape {
  authorName?: string;
  authorUrl?: string;
  logoUrl?: string | null;
  siteName?: string;
  siteUrl?: string;
  i18n?: {
    defaultLocale: string;
    locales: string[];
    localeMap: Record<string, string>;
  };
}

interface BlogPostingArgs {
  entry: CollectionEntry<'blog'>;
  siteUrl: string;
  siteName: string;
  mediaDomain: string | null;
  brand: BrandShape;
}

function urlSlug(id: string): string {
  return id.replace(/^[a-z]{2}\//, '');
}

function resolveOgUrl(entry: CollectionEntry<'blog'>, siteUrl: string, mediaDomain: string | null, locale?: string): string {
  if (entry.data.ogImage) return entry.data.ogImage;
  const slug = urlSlug(entry.id);
  const localePart = locale ? `${locale}/` : '';
  if (mediaDomain) return `https://${mediaDomain}/og/${localePart}${slug}.png`;
  return new URL(`/og/${localePart}${slug}.png`, siteUrl).toString();
}

export function blogPostingLd({ entry, siteUrl, siteName, mediaDomain, brand }: BlogPostingArgs) {
  const locale = entry.data.locale ?? brand.i18n?.defaultLocale ?? 'en';
  const isDefault = locale === (brand.i18n?.defaultLocale ?? 'en');
  const slug = urlSlug(entry.id);
  const postPath = isDefault ? `/blog/${slug}` : `/${locale}/blog/${slug}`;
  const postUrl = new URL(postPath, siteUrl).toString();
  const ogImage = resolveOgUrl(entry, siteUrl, mediaDomain, locale);

  const author = brand.authorName
    ? {
        '@type': 'Person' as const,
        name: brand.authorName,
        ...(brand.authorUrl ? { url: brand.authorUrl } : {}),
      }
    : {
        '@type': 'Organization' as const,
        name: siteName,
        url: siteUrl,
      };

  const publisher = {
    '@type': 'Organization' as const,
    name: siteName,
    url: siteUrl,
    ...(brand.logoUrl
      ? { logo: { '@type': 'ImageObject' as const, url: brand.logoUrl } }
      : {}),
  };

  const inLanguage = brand.i18n?.localeMap?.[locale] ?? locale;

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: entry.data.title,
    description: entry.data.excerpt,
    image: ogImage,
    datePublished: entry.data.date.toISOString(),
    dateModified: (entry.data.dateModified ?? entry.data.date).toISOString(),
    inLanguage,
    author,
    publisher,
    mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
    keywords: (entry.data.tags ?? []).join(', '),
    articleSection: entry.data.type,
  };
}

interface WebSiteArgs {
  siteUrl: string;
  siteName: string;
}

export function webSiteLd({ siteUrl, siteName }: WebSiteArgs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
    // No SearchAction here. It requested the sitelinks searchbox, which Google
    // removed from results on 2024-11-21 — the markup is still valid and still
    // ignored, so it was pure weight. The rest of WebSite is unaffected and is
    // still what carries the site name.
  };
}

/**
 * Schema.org BreadcrumbList for blog posts.
 * Renders: Home › Blog › Post title
 * Per-locale paths respect prefixDefaultLocale:false.
 */
interface BreadcrumbArgs {
  entry: CollectionEntry<'blog'>;
  siteUrl: string;
  brand: BrandShape;
}
export function breadcrumbLd({ entry, siteUrl, brand }: BreadcrumbArgs) {
  const locale = entry.data.locale ?? brand.i18n?.defaultLocale ?? 'en';
  const isDefault = locale === (brand.i18n?.defaultLocale ?? 'en');
  const slug = entry.id.replace(/^[a-z]{2}\//, '');
  const localePrefix = isDefault ? '' : `/${locale}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: new URL(`${localePrefix}/`, siteUrl).toString(),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: new URL(`${localePrefix}/blog`, siteUrl).toString(),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: entry.data.title,
        item: new URL(`${localePrefix}/blog/${slug}`, siteUrl).toString(),
      },
    ],
  };
}
