// Edit this one file to brand the site.
//
// Everything below feeds the <head> meta, the JSON-LD, the design page and the
// media kit. Nothing else needs touching to make this site yours — which is the
// point: one file to change, not fourteen.

export const config = {
  // Set this to a Cloudflare custom domain if you serve images from R2.
  // Left null, images resolve relative to siteUrl and no remote-pattern
  // allowlisting is needed.
  mediaDomain: null,

  brand: {
    // --- who you are --------------------------------------------------------
    siteName: 'Example Site',
    siteUrl: 'https://example.com',
    tagline: 'A small site about something worth writing down.',

    // The address the contact form delivers to. This must be a *verified
    // destination* in Cloudflare Email Service — see CLAUDE.md § Operator steps.
    contactEmail: 'hello@example.com',

    // Optional, and they make richer social cards.
    authorName: 'Example',
    authorUrl: 'https://example.com',
    twitterSite: '@example',
    twitterCreator: '@example',

    logoUrl: '/logo.svg',

    // --- Cloudflare Web Analytics ------------------------------------------
    // Free, cookieless, no consent banner. Paste the site token from
    // Cloudflare dashboard → Web Analytics → your site, and the beacon in
    // RootLayout.astro starts reporting.
    //
    // Null here on purpose: this is a reference site with no domain, and a
    // made-up token would look configured while measuring nothing. The audit
    // reports it as "wired but the token is unset", which is the truth.
    //
    // NB Cloudflare's automatic beacon injection only rewrites proxied STATIC
    // responses. A site served by a Worker — which this is — is not rewritten,
    // so the <script> in the layout is how the beacon gets there. Auto-install
    // will silently do nothing and still show the site as set up.
    cloudflareAnalyticsToken: null,
  },
};
