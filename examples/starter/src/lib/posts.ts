import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/**
 * The one publish predicate.
 *
 * The blog index, the RSS feed and /llms.txt must agree on what is public — if
 * they disagree, a draft leaks through whichever one forgot. One function, three
 * callers, no way to drift.
 */
export function isPublished(post: Post): boolean {
  return !post.data.draft;
}

/** Published posts, newest first. */
export async function publishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog');
  return posts
    .filter(isPublished)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Every tag in use, with how many published posts carry it. */
export async function tagCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const post of await publishedPosts()) {
    for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
