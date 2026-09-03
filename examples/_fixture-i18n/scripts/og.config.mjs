// _fixture-i18n OG config — multi-locale (en + hu).
//
// OG cards are generated into public/og/<locale>/ by scripts/og.mjs and ship
// with the site, so og:image always resolves against siteUrl. That is true
// whether or not a media domain is set: the bucket is for content photos, never
// for cards. Wiring cards to the media domain produced a 404 og:image on the
// first site that had a bucket (2026-09-02).
//
// Brand inputs below drive both the card template and the SEO meta.

export const config = {
  bucket: null,
  mediaDomain: null,

  devPort: 4321,

  brand: {
    palette: {
      background: '#0a0a0a',
      primary: '#33FF33',
      secondary: '#FFB000',
      text: '#ffffff',
      muted: '#888888',
    },
    fontName: 'system-ui',

    // Cloudflare Web Analytics site token. Null here: the fixture only ever runs
    // on localhost, so there is nothing to measure and a made-up token would
    // look configured while reporting nothing. A real site pastes its token from
    // the dashboard (Web Analytics → the site) and the beacon renders.
    //
    // CRITICAL, and the reason the beacon is written into RootLayout.astro by
    // hand: Cloudflare's "auto-install" toggle only rewrites proxied STATIC
    // responses. A site served by a Worker — which is the deploy shape this
    // baseline uses — is not rewritten, so auto-install silently does nothing
    // while the dashboard still shows the site as set up. Check a deployed site
    // by curl-grepping the served HTML for 'cloudflareinsights'; if it is not
    // there, no data is flowing.
    cloudflareAnalyticsToken: null,

    siteName: 'rider i18n fixture',
    siteUrl: 'http://localhost:4321',
    logoUrl: null,
    tagline: 'Multi-locale (en + hu) test bed for the rider contract.',
    authorName: 'Example',
    authorUrl: 'https://example.com',
    twitterSite: '@example',
    twitterCreator: '@example',

    //multi-locale i18n block (single source of truth, matches astro.config.mjs).
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'hu'],
      localeMap: { en: 'en-US', hu: 'hu-HU' },
    },
  },
};
