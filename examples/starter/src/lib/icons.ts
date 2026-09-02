/**
 * The icons this site uses, inline. Nothing else.
 *
 * Each entry is the inner markup of a 24×24 Lucide glyph (ISC licence,
 * https://lucide.dev), copied once from the set's published data on 2026-09-02.
 * Adding an icon means copying one more body here; the page never loads a set
 * it does not use, and there is no icon package to install. `currentColor`
 * throughout, so a glyph takes the colour of the text around it.
 */
export const ICONS = {
  "rss": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16\"/><circle cx=\"5\" cy=\"19\" r=\"1\"/></g>",
  "mail": "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"m22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/></g>",
} as const;

export type IconName = keyof typeof ICONS;
