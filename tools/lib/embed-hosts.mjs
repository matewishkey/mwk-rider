// embed-hosts — third-party `<iframe>` embeds heavy enough that loading one
// eagerly is a measurable page-speed defect.
//
// Why a table rather than "any cross-origin iframe": the cost that matters is
// the *payload behind* the frame, and these are the widgets that pull hundreds
// of kilobytes over dozens of requests. A same-origin iframe, or a small
// third-party one, is not the thing this check is about.
//
// The case that produced it (cypruspokerbrisbane.com, 2026-05-31): a Google Maps
// `output=embed` iframe in the second section pulled ~360 KB across ~20
// requests. Under PageSpeed's simulated Slow-4G that saturated bandwidth before
// the page could paint. Replacing it with an IntersectionObserver facade — a
// static placeholder that injects the iframe only when the user scrolls near it
// — moved mobile Performance 70 → 97, FCP 3.5 s → 1.5 s, LCP 5.5 s → 2.0 s.

/**
 * [pattern, product] — matched against the iframe's `src`.
 *
 * Matching on the URL rather than the hostname alone is deliberate: Google Maps
 * ships as `google.com/maps?output=embed`, on a domain that also serves plenty
 * of things this check has no opinion about.
 */
export const EMBED_SIGNALS = [
  [/(?:^|\/\/|\.)google\.[a-z.]+\/maps\b|[?&]output=embed\b|maps\.google\./i, 'Google Maps'],
  [/(?:^|\.)youtube(?:-nocookie)?\.com\/embed\//i,                            'YouTube'],
  [/player\.vimeo\.com\/video\//i,                                            'Vimeo'],
  [/(?:^|\.)dailymotion\.com\/embed\//i,                                      'Dailymotion'],
  [/(?:^|\.)platform\.twitter\.com\/|(?:^|\.)twitter\.com\/i\/|platform\.x\.com\//i, 'X / Twitter'],
  [/(?:^|\.)instagram\.com\/(?:p|reel)\/[^"'\s]*\/embed/i,                    'Instagram'],
  [/(?:^|\.)facebook\.com\/plugins\//i,                                       'Facebook plugin'],
  [/open\.spotify\.com\/embed\//i,                                            'Spotify'],
  [/w\.soundcloud\.com\/player\//i,                                           'SoundCloud'],
  [/(?:^|\.)calendly\.com\//i,                                                'Calendly'],
  [/(?:^|\.)typeform\.com\//i,                                                'Typeform'],
  [/(?:^|\.)docs\.google\.com\/(?:forms|spreadsheets|document)\//i,           'Google Docs'],
  [/(?:^|\.)codepen\.io\/[^"'\s]*\/embed\//i,                                 'CodePen'],
  [/(?:^|\.)airtable\.com\/embed\//i,                                         'Airtable'],
];

/** Which heavy embed this src is, or null. */
export function embedProduct(src) {
  for (const [re, name] of EMBED_SIGNALS) if (re.test(src)) return name;
  return null;
}

/**
 * Strip the regions where an iframe is markup a browser does not fetch.
 *
 * `<template>` is inert — cloning it at scroll time is precisely how a facade is
 * built — and `<noscript>` is the correct no-JS fallback *for* a facade. Both
 * are the compliant pattern, so scanning them would flag the fix as the defect.
 * Comments go too, for the usual reason.
 */
export function fetchableMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
}
