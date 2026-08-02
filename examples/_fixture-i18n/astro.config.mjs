// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import robotsTxt from 'astro-robots-txt';
import icon from 'astro-icon';
import { postLastmods, lastmodSerializer } from './scripts/sitemap-lastmod.mjs';

// <lastmod> comes from the post's own dateModified/date — @astrojs/sitemap emits
// none unless serialize() supplies it, and a sitemap without it can't tell a
// crawler what changed.
const lastmods = postLastmods(process.cwd(), { defaultLocale: 'en' });

// _fixture-i18n — the wishbusterz-rider multi-locale test bed (contract.
// Two locales: en (default at root) + hu (at /hu/). Local-only fixture;
// no R2 bucket, no real deploy. Used by /wishbusterz-rider-preview to drive
// localhost validation of the multi-locale stack before patterns get
// promoted to templates/ and shipped to managed sites.
export default defineConfig({
  site: 'http://localhost:4321',
  output: 'static',
  trailingSlash: 'never',

  //canonical multi-locale routing
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'hu'],
    routing: {
      prefixDefaultLocale: false,         // default locale at root: /, /blog
      // redirectToDefaultLocale is incompatible with prefixDefaultLocale: false
      // (Astro 6 rejects the combo to prevent infinite redirect loops). The
      // contractcurrently prescribes redirectToDefaultLocale: true —
      // this is a contract bug surfaced by this fixture. Phase 2: fix.
      fallbackType: 'rewrite',            // serve fallback at the locale URL
    },
    fallback: { hu: 'en' },               // missing hu → serve en at /hu/...
  },

  integrations: [
    icon(),
    mdx(),
    sitemap({
      //preview routes never enter the sitemap.
      filter: (page) => !page.includes('/preview'),
      serialize: lastmodSerializer(lastmods),
      //auto-emit hreflang alternates per URL.
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en-US',
          hu: 'hu-HU',
        },
      },
    }),
    robotsTxt({
      //preview routes blocked from crawlers.
      policy: [
        { userAgent: '*', disallow: '/preview/' },
        { userAgent: '*', allow: '/' },
      ],
    }),
  ],
});
