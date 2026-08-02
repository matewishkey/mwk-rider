// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import robotsTxt from 'astro-robots-txt';
import icon from 'astro-icon';

// _fixture-i18n — the td-rider multi-locale test bed (contract §18).
// Two locales: en (default at root) + hu (at /hu/). Local-only fixture;
// no R2 bucket, no real deploy. Used by /td-rider-preview to drive
// localhost validation of the multi-locale stack before patterns get
// promoted to templates/ and shipped to managed sites.
export default defineConfig({
  site: 'http://localhost:4321',
  output: 'static',
  trailingSlash: 'never',

  // §18.1 — canonical multi-locale routing
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'hu'],
    routing: {
      prefixDefaultLocale: false,         // default locale at root: /, /blog
      // redirectToDefaultLocale is incompatible with prefixDefaultLocale: false
      // (Astro 6 rejects the combo to prevent infinite redirect loops). The
      // contract §18.1 currently prescribes redirectToDefaultLocale: true —
      // this is a contract bug surfaced by this fixture. Phase 2: fix §18.1.
      fallbackType: 'rewrite',            // serve fallback at the locale URL
    },
    fallback: { hu: 'en' },               // missing hu → serve en at /hu/...
  },

  integrations: [
    icon(),
    mdx(),
    sitemap({
      // §14 exclusion #1 — preview routes never enter the sitemap.
      filter: (page) => !page.includes('/preview'),
      // §18.4 — auto-emit hreflang alternates per URL.
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en-US',
          hu: 'hu-HU',
        },
      },
    }),
    robotsTxt({
      // §14 exclusion #2 — preview routes blocked from crawlers.
      policy: [
        { userAgent: '*', disallow: '/preview/' },
        { userAgent: '*', allow: '/' },
      ],
    }),
  ],
});
