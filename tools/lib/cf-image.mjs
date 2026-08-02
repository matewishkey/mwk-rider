// Cloudflare Image-Transformation URL helpers, shared by the offline (built HTML)
// and live (rendered HTML) image checks so both flag the same param anti-patterns.
//
// A transform URL is /cdn-cgi/image/<comma-separated-options>/<source>. We flag:
//   - explicit non-auto format (format=webp/avif/jpeg/…): no AVIF negotiation, and
//     onerror=redirect then serves the raw source to clients that don't accept it
//   - missing quality=: Cloudflare defaults to 85; an explicit cap (e.g. 80) is
//     usually a large win on photographic content
// Aliases per Cloudflare docs: format|f, quality|q. (Verified via context7.)

export function isTransformUrl(src) {
  return /\/cdn-cgi\/image\//.test(src);
}

// The options segment between /cdn-cgi/image/ and the source path, or null.
export function transformOptions(src) {
  return src.match(/\/cdn-cgi\/image\/([^/]+)\//)?.[1] ?? null;
}

// { explicitFormat: <fmt|null>, missingQuality: <bool> }, or null if not a transform URL.
export function transformSmells(src) {
  const opts = transformOptions(src);
  if (opts == null) return null;
  const fmt = opts.match(/(?:^|,)(?:format|f)=([^,]+)/i)?.[1]?.toLowerCase();
  const hasQuality = /(?:^|,)(?:quality|q)=/i.test(opts);
  return {
    explicitFormat: fmt && fmt !== 'auto' ? fmt : null,
    missingQuality: !hasQuality,
  };
}
