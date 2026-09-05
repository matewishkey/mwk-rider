// text — the small string helpers a finding message needs.
//
// `truncate` had five byte-identical definitions (images, perf, seo, live,
// lighthouse) before this file existed. Nothing was wrong with any of them; five
// copies of a one-liner is just five places for one to drift into a subtly
// different ellipsis or off-by-one and make two findings disagree about how a
// URL is shortened.

/**
 * `s` cut to at most `n` characters, with the last one spent on an ellipsis.
 *
 * The ellipsis is a single character (…), so a truncated string is exactly `n`
 * long — the callers use this to keep a URL inside a report line.
 */
export function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
