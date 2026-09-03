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

/**
 * What a cover actually renders at, which is NOT the same as the page width.
 *
 * The column is `.wrap { max-width: var(--measure); padding: var(--space-4) }`
 * in global.css — 68ch, about 570px in the shipped stack, minus 1rem of padding
 * on each side. So the image box tops out near 540px, and below that it is the
 * viewport minus the same 2rem.
 *
 * The old value claimed 800px. `sizes` is a promise to the browser about layout,
 * and an overstated one is expensive in the direction nothing warns about: on a
 * DPR-2 desktop it asked for 1600px of image for a 540px box — 2.97×, past this
 * repo's own oversized-image threshold of 2.5. Keep this in step with
 * `--measure` if the column ever changes.
 */
export const CONTENT_SIZES = '(max-width: 570px) calc(100vw - 2rem), 540px';

export function mediaSrc(key: string, width: number): string {
  const domain = config.mediaDomain;
  if (!domain) throw new Error(`cover key "${key}" needs mediaDomain in scripts/og.config.mjs — the bucket's custom domain`);
  return `https://${domain}/cdn-cgi/image/width=${width},quality=80,format=auto/${key}`;
}

export function mediaSrcset(key: string, maxWidth: number): string {
  // Never offer a rung wider than the source — the edge would upscale it. A
  // source narrower than the smallest rung leaves no rungs at all, and an empty
  // `srcset=""` is worse than none, so fall back to the source's own width.
  const rungs = LADDER.filter((w) => w <= maxWidth);
  const widths = rungs.length ? rungs : [maxWidth];
  return widths.map((w) => `${mediaSrc(key, w)} ${w}w`).join(', ');
}
