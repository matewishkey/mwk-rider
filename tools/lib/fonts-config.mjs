// fonts-config — the `fonts: [...]` entries declared in astro.config, read as
// TEXT (this tool never executes a project's code — see lib/project.mjs).
//
// The defaults below are read off the installed package rather than recalled:
// `astro/dist/assets/fonts/constants.js` in astro@7.1.6 declares
//   DEFAULTS = { weights: ['400'], styles: ['normal','italic'], subsets: ['latin'],
//                fallbacks: ['sans-serif'], optimizedFallbacks: true, formats: ['woff2'] }
// The one that costs bytes silently is `styles`: a family declared without it
// gets italic faces built and shipped whether or not anything renders italic.
export const FONT_DEFAULT_STYLES = ['normal', 'italic'];

/**
 * Every family in the config's `fonts:` array, as
 * { name, cssVariable, hasStyles, hasWeights, hasSubsets }.
 *
 * Returns [] when there is no fonts array — which is not the same as an empty
 * one, but no caller distinguishes them and both mean "nothing to judge".
 */
export function fontFamilies(configText) {
  if (!configText) return [];
  const start = configText.search(/\bfonts\s*:\s*\[/);
  if (start === -1) return [];
  const open = configText.indexOf('[', start);
  const block = balanced(configText, open, '[', ']');
  if (block == null) return [];

  const out = [];
  for (const entry of objectsIn(block)) {
    const name = str(entry, 'name');
    const cssVariable = str(entry, 'cssVariable');
    if (!name && !cssVariable) continue;
    out.push({
      name,
      cssVariable,
      hasStyles: /\bstyles\s*:/.test(entry),
      hasWeights: /\bweights\s*:/.test(entry),
      hasSubsets: /\bsubsets\s*:/.test(entry),
    });
  }
  return out;
}

function str(text, key) {
  return text.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`))?.[2] ?? null;
}

/** The substring from `open` to its matching close, exclusive of both. */
function balanced(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Top-level `{ … }` objects in an array body. */
function objectsIn(block) {
  const out = [];
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== '{') continue;
    const body = balanced(block, i, '{', '}');
    if (body == null) break;
    out.push(body);
    i += body.length + 1;
  }
  return out;
}
