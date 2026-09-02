/**
 * Structured data — the two shapes that pay off.
 *
 * A `BlogPosting` per article and one site-wide `WebSite`. Search engines use
 * them to build rich results; without them a crawler has to infer everything
 * from the prose. Serialised with JSON.stringify and `set:html` so quoting can
 * never break the block — hand-written JSON-LD in a template usually does, and
 * an unparseable block is discarded whole while looking fine in the source.
 */
import type { CollectionEntry } from 'astro:content';

interface Brand {
  siteName: string;
  siteUrl: string;
  tagline?: string;
  authorName?: string;
  authorUrl?: string;
  logoUrl?: string | null;
}

export function blogPostingLd(entry: CollectionEntry<'blog'>, brand: Brand, ogImage: string) {
  const postUrl = new URL(`/blog/${entry.id}`, brand.siteUrl).toString();

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: entry.data.title,
    description: entry.data.excerpt,
    image: ogImage,
    datePublished: entry.data.date.toISOString(),
    dateModified: (entry.data.dateModified ?? entry.data.date).toISOString(),
    author: brand.authorName
      ? { '@type': 'Person', name: brand.authorName, ...(brand.authorUrl ? { url: brand.authorUrl } : {}) }
      : { '@type': 'Organization', name: brand.siteName, url: brand.siteUrl },
    publisher: {
      '@type': 'Organization',
      name: brand.siteName,
      url: brand.siteUrl,
      ...(brand.logoUrl
        ? { logo: { '@type': 'ImageObject', url: new URL(brand.logoUrl, brand.siteUrl).toString() } }
        : {}),
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
    keywords: entry.data.tags.join(', '),
  };
}

export function webSiteLd(brand: Brand) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brand.siteName,
    url: brand.siteUrl,
    ...(brand.tagline ? { description: brand.tagline } : {}),
  };
}
