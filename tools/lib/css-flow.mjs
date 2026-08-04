// css-flow — which elements CSS takes OUT of normal flow.
//
// The CLS checks ask one question of an `<img>`: does it carry width + height?
// For an in-flow content image that is the right question — without them the
// browser reserves nothing and everything below jumps when the image lands.
//
// For an absolutely-positioned image it is the wrong question entirely. An
// out-of-flow element is painted into a box its positioned parent already
// reserved; it has no siblings to push, and `width`/`height` attributes would
// change nothing because `inset: 0` + `height: 100%` override the intrinsic
// ratio they establish. tasmanvisa-web reported 20 `images: cls` findings that
// were all this shape — 20 of the 21 required findings in the whole live run —
// on a page rider's own `browser` domain measured at CLS 0.001 and Lighthouse
// measured at 0. When a measured signal and a static heuristic disagree that
// loudly, the heuristic is what needs fixing.
//
// It is also the shape rider's *other* advice produces: `images:
// background-image` pushes a site off CSS backgrounds, and the replacement it
// names is precisely an absolutely-inset `object-fit: cover` <img>. The more
// compliant the site, the more of these it has.
//
// This reads selectors, not a cascade. It cannot know which rule wins, so it
// answers the weaker question — "does any rule matching this element take it out
// of flow?" — and errs toward silence. Missing one genuinely shifting image
// costs a finding; crying wolf 20 times costs the domain its credibility.

// A rule body, minus nested at-rule wrappers: `@media (x) { .a { … } }` never
// matches as a whole (its body has braces), so the engine advances and matches
// the inner `.a { … }` on its own. Flat rules and nested ones both land here.
const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
const OUT_OF_FLOW_RE = /(?:^|[\s;{])position\s*:\s*(?:absolute|fixed)\s*(?:;|!|$)/i;
const CLASS_RE = /\.(-?[A-Za-z_][\w-]*)/g;
const ID_RE = /#(-?[A-Za-z_][\w-]*)/g;
// Bare element selectors, so `img { position: absolute }` counts. Only the
// tag names an <img> can be selected by; a compound like `.hero img` yields
// `img` here too, which is the conservative reading.
const TAG_RE = /(?:^|[\s>+~,(])(img|picture)(?=$|[\s>+~,.:#\[])/gi;

/**
 * Selectors that put an element out of normal flow, as { classes, ids, tags }.
 *
 * Pass every stylesheet a document loads (and its inline `<style>` blocks) to
 * build one set — an element is out of flow if *any* sheet says so.
 */
export function outOfFlowSelectors(cssTexts) {
  const classes = new Set(), ids = new Set(), tags = new Set();
  for (const raw of cssTexts) {
    if (!raw) continue;
    const css = String(raw).replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const [, selector, body] of css.matchAll(RULE_RE)) {
      if (!OUT_OF_FLOW_RE.test(body)) continue;
      for (const [, c] of selector.matchAll(CLASS_RE)) classes.add(c);
      for (const [, i] of selector.matchAll(ID_RE)) ids.add(i);
      for (const [, t] of selector.matchAll(TAG_RE)) tags.add(t.toLowerCase());
    }
  }
  return { classes, ids, tags };
}

/** Every `<style>` block's contents in a document. */
export function inlineStyles(html) {
  return [...String(html ?? '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

/** Every `<link rel="stylesheet">` href in a document, in order. */
export function stylesheetHrefs(html) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    if (!/(?:^|\s)stylesheet(?:\s|$)/i.test(attrs.match(/(?:^|\s)rel\s*=\s*["']?([^"'>]*)/i)?.[1] ?? '')) continue;
    const href = attrs.match(/(?:^|\s)href\s*=\s*(["'])([^"']*)\1/i)?.[2]
              ?? attrs.match(/(?:^|\s)href\s*=\s*([^\s>"']+)/i)?.[1];
    if (href) out.push(href);
  }
  return out;
}

/**
 * Is this `<img>` out of normal flow — and so unable to shift the page?
 *
 * `attrs` is the raw attribute string of the tag. An inline
 * `style="position:absolute"` answers on its own; otherwise the tag's classes
 * and id are matched against what the stylesheets positioned.
 */
export function isOutOfFlow(attrs, flow) {
  const style = attrs.match(/(?:^|\s)style\s*=\s*(["'])([^"']*)\1/i)?.[2] ?? '';
  if (OUT_OF_FLOW_RE.test(`;${style};`)) return true;
  if (!flow) return false;
  if (flow.tags?.has('img')) return true;
  const classAttr = attrs.match(/(?:^|\s)class\s*=\s*(["'])([^"']*)\1/i)?.[2]
                 ?? attrs.match(/(?:^|\s)class\s*=\s*([^\s>"']+)/i)?.[1] ?? '';
  if (classAttr.split(/\s+/).some((c) => c && flow.classes.has(c))) return true;
  const id = attrs.match(/(?:^|\s)id\s*=\s*(["'])([^"']*)\1/i)?.[2]
          ?? attrs.match(/(?:^|\s)id\s*=\s*([^\s>"']+)/i)?.[1] ?? '';
  return Boolean(id && flow.ids.has(id));
}
