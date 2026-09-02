/**
 * robots.txt as an endpoint rather than a package.
 *
 * What matters is that the build ships a robots.txt carrying a `Sitemap:` line
 * — that is how a crawler arriving at the root finds the full URL list. Nine
 * lines of code do that as well as a dependency does, and they don't collide
 * with the sitemap integration.
 */
import type { APIRoute } from 'astro';
import { config as ogConfig } from '../../scripts/og.config.mjs';

export const GET: APIRoute = () =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      '',
      `Sitemap: ${new URL('/sitemap-index.xml', ogConfig.brand.siteUrl).toString()}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
