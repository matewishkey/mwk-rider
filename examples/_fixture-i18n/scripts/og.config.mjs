// _fixture-i18n OG config — multi-locale (en + hu).
//
// Fixture mode: mediaDomain is null. OG PNGs live in public/og/<locale>/
// rather than R2. SEO.astro + jsonld.ts detect null mediaDomain and
// resolve og:image relative to the site URL instead.
//
// Real managed sites set mediaDomain to a CF custom domain (per.
// Brand inputs drive both the OG template page and SEO meta.

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

    // Cloudflare Web Analytics token. Null in the fixture (localhost-only —
    // no analytics needed). Managed sites set this to their site_tag from
    // https://one.dash.cloudflare.com/<account>/web-analytics — single line,
    // and the beacon script renders. SeeObservability.
    //
    // CRITICAL: Cloudflare's "auto-install" toggle in the dashboard only
    // injects the beacon for orange-cloud proxied static HTML. Sites on
    // Workers Builds (the canonical rider deploy shape perserve via
    // a Worker, which CF does NOT rewrite. Auto-install silently does
    // nothing. **Manual <script> injection in RootLayout.astro is mandatory
    // for every rider managed site.** Audit existing managed sites by
    // curl-grepping for 'cloudflareinsights' — if absent, no data flows.
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
