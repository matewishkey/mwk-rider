import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/posts';
import { config as ogConfig } from '../../scripts/og.config.mjs';

const { brand } = ogConfig;

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog'))
    .filter(isPublished)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: brand.siteName,
    description: brand.tagline,
    site: brand.siteUrl,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.excerpt,
      pubDate: post.data.date,
      link: `/blog/${post.id}`,
      categories: post.data.tags,
    })),
  });
};
