/**
 * URLs for content media in the site's R2 bucket.
 *
 * Every URL goes through Cloudflare's transform endpoint on the media domain,
 * so the edge resizes and re-encodes per request and the original is stored
 * once. `format=auto` lets it negotiate AVIF/WebP from the browser's Accept
 * header. `quality=80` is set explicitly: Cloudflare defaults to 85, which is
 * generous for photographs, and the audit suggests a cap for exactly that
 * reason (BEST-PRACTICES § images). Both are checked on the built HTML.
 */
import { config } from '../../scripts/og.config.mjs';

/** The widths a responsive image is offered at. The browser picks one. */
export const LADDER = [480, 800, 1200, 1600] as const;

/** What a post body is: full width on a phone, capped on a desktop. */
export const CONTENT_SIZES = '(max-width: 800px) 100vw, 800px';

export function mediaSrc(key: string, width: number): string {
  const domain = config.mediaDomain;
  if (!domain) throw new Error(`cover key "${key}" needs mediaDomain in scripts/og.config.mjs — the bucket's custom domain`);
  return `https://${domain}/cdn-cgi/image/width=${width},quality=80,format=auto/${key}`;
}

export function mediaSrcset(key: string, maxWidth: number): string {
  // Never offer a rung wider than the source — the edge would upscale it.
  return LADDER.filter((w) => w <= maxWidth).map((w) => `${mediaSrc(key, w)} ${w}w`).join(', ');
}
