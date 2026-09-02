// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { config as brandConfig } from './scripts/og.config.mjs';
import { postLastmods, lastmodSerializer } from './scripts/sitemap-lastmod.mjs';

// <lastmod> comes from each post's own dateModified/date. @astrojs/sitemap emits
// none unless serialize() supplies one, so a sitemap can be perfectly well
// configured and still tell a crawler nothing about what changed.
const lastmods = postLastmods(process.cwd());

export default defineConfig({
  site: brandConfig.brand.siteUrl,
  trailingSlash: 'never',

  // Static, with exactly one exception.
  //
  // Every page here is prerendered. src/pages/api/contact.ts is the one route
  // that renders on demand (`export const prerender = false`), because it has to
  // run when someone submits the form. That single route is why the adapter is
  // installed — not because the site is server-rendered.
  //
  // /contact itself stays prerendered deliberately: it keeps the page in dist/
  // and in the sitemap, so it carries canonical/OG/JSON-LD/<h1> like every other
  // page and counts in the audit's coverage denominators. A server-rendered
  // contact page would be declared in the sitemap and invisible to any check
  // that reads built HTML — silently unverified.
  output: 'static',

  // The media bucket's custom domain, once it exists. Post covers from R2 are
  // raw <img> tags pointing at Cloudflare's transform URL and never pass
  // through Astro's image service, so strictly this is not needed for them —
  // it is here so that <Image src="https://media.…"> also works, and because
  // the audit treats a media domain that is not allow-listed as a mistake.
  image: {
    remotePatterns: brandConfig.mediaDomain ? [{ protocol: 'https', hostname: brandConfig.mediaDomain }] : [],
  },

  // Astro 7 changed this default from `true` to `'jsx'`, which strips whitespace
  // by JSX rules — including the newline between prose and an inline element, so
  //
  //     operates the website
  //     <a href="…">example.test</a>.
  //
  // ships as `operates the websiteexample.test.` It builds clean, typechecks
  // clean, and is wrong only in the rendered text (measured on astro@7.1.6;
  // `true` keeps the space). A content site is exactly where prose meets inline
  // elements constantly, so the baseline takes the HTML-aware behaviour back.
  //
  // The audit does not demand this value — it demands the choice be explicit,
  // because inheriting a changed default is not choosing.
  compressHTML: true,

  adapter: cloudflare({
    // Deliberate, and worth understanding before changing.
    //
    // This option's default changed from 'compile' to 'cloudflare-binding',
    // which transforms images at RUNTIME using the Cloudflare Images binding —
    // "automatically provisioned upon deployment", i.e. a paid product. Adding
    // this adapter for the contact form alone would otherwise opt you into
    // billing for image transforms you were already getting for free.
    //
    // 'compile' keeps Sharp doing the work at build time, in CI, once.
    imageService: 'compile',
  }),

  integrations: [
    mdx(),
    sitemap({
      // 404 is not a page anyone should be pointed at.
      filter: (page) => !page.endsWith('/404'),
      serialize: lastmodSerializer(lastmods),
    }),
  ],
});
