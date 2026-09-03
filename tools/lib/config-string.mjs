// config-string — read a string-literal config value out of source TEXT.
//
// `scripts/og.config.mjs` and the `fonts: [...]` block in astro.config both hold
// values this tool needs and both are read as text, never executed (the SAFETY
// note in lib/project.mjs has the why). Two copies of the same regex lived in
// those two files and both carried the same bug, so there is one copy now.
//
// THE BUG, because it is the whole reason this file exists: the value class used
// to be `[^'"`]*` — every quote character excluded, whichever one opened the
// literal. So a value containing the *other* quote did not match at all, and a
// non-match is indistinguishable from an absent key:
//
//     tagline: "Australia's visa specialists"   →  read as MISSING
//
// which `seo: brand.tagline` then reported as `missing (used by SEO meta)` — a
// required finding under --strict, against a config that is completely correct.
// An apostrophe in a tagline or a site name is ordinary English, not an edge
// case. The class now excludes only the quote that opened the literal, and
// backslash escapes are honoured so `'It\'s'` reads as `It's`.

/**
 * The string value of `key` in `text`, or null when the key is absent.
 *
 * Matches `key: '…'`, `key: "…"` and `key: `…`` — the value ends at the first
 * unescaped occurrence of the quote that opened it. Only single-line literals
 * are read: a value split across lines is not something these configs write, and
 * allowing newlines lets a stray quote swallow the rest of the file.
 */
export function configString(text, key) {
  const m = String(text ?? '').match(
    new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1`),
  );
  return m ? unescapeLiteral(m[2]) : null;
}

// The escapes a hand-written config actually uses. Anything else keeps the
// character that followed the backslash, which is what JS does for an unknown
// escape anyway.
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function unescapeLiteral(s) {
  return s.replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c);
}
