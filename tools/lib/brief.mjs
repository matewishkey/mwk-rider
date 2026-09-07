// brief — a design brief someone pasted, read as data.
//
// Create mode can be handed one of these instead of asking its three questions.
// The person picked a look somewhere else and arrived with the decision already
// made; asking them "what colour" again is the worst thing this tool could do
// with that. So the brief comes in as a paste, and this module turns it into a
// plan — which versions to build, the exact token values each one gets, which
// content set fills it — or refuses it and says which part it could not read.
//
// Two rules run through all of it.
//
// **A brief is recognised by SHAPE, never by who wrote it.** The spec names its
// own generator. Matching on that string would hard-code one producer's name
// into this repo and make every other producer's brief unreadable for no reason
// at all. A brief is a brief when it carries versions that name colour and type.
//
// **Every byte of it is someone else's**, and half of it arrives over the wire
// from a URL the paste itself names. Nothing here is executed, no string is
// trusted for length, and every value that reaches a directory name, a
// stylesheet or a config file is re-derived from a strict pattern rather than
// passed through. `Inter"; import fs from "node:fs` is a legal-looking font
// family right up until it lands in astro.config.mjs.

/** The ten fields a page needs. A content set is these, plus its own id. */
export const CONTENT_FIELDS = ['site', 'name', 'eyebrow', 'title', 'sub', 'cta', 'cta2', 'nav', 'facts', 'sections', 'posts'];

/**
 * Design fields a content set must NOT carry.
 *
 * Content says what a page is about; the version says what it looks like. A set
 * arriving with a font or a hue in it means those two halves have merged
 * somewhere upstream, and the look the person actually chose would silently lose
 * to whatever the words brought with them.
 */
export const FORBIDDEN_CONTENT_FIELDS = ['fonts', 'font', 'hue', 'family', 'archetype', 'recipe', 'art', 'palette', 'colour', 'color', 'style', 'layout', 'css'];

// Caps. Not guesses: measured across the 1318 content sets published on
// 2026-09-07, whose longest string of any kind was 189 characters and whose
// longest array held 5 items. These leave several times that headroom and still
// bound what a hostile or merely broken payload can put into a page.
const MAX_STRING = 600;
const MAX_ITEMS = 24;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

// What may reach a file. Anything else is dropped and reported — never repaired,
// because a repaired value is a value nobody chose.
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN_NAME = /^--[a-z0-9][a-z0-9-]{0,63}$/;
// Every one of the 69 families in the catalogue this brief format is emitted
// from passes this; no quote, backslash, newline or `${` can.
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

/**
 * The `fonts:` entry shape each family gets in astro.config.mjs.
 *
 * Two weights, listed, and `styles: ['normal']`. Both halves are load-bearing
 * and the first is not what it looks like.
 *
 * Astro's docs recommend a weight RANGE ("400 800") for a variable font, and for
 * a variable family that is right — one file covers the range. But a brief names
 * two families and says nothing about which are variable, and a range asked of a
 * STATIC family expands to one face per weight Google publishes in it. Measured
 * on 2026-09-07 against the starter, with Playfair Display (variable) and
 * Spectral (static): two ranges produced 5 @font-face declarations and a 🔧 from
 * `perf: font:faces` under --strict — the shape a brief said had been verified
 * clean. The same pair as two listed weights each produced 4 faces in 3 files,
 * 66 KB, and a clean --strict run, and it is the only form that passed for both
 * kinds of family.
 *
 * `styles: ['normal']` is the cheaper trap: Astro's default is
 * ['normal','italic'], so a family declared without it builds and ships italic
 * faces whether or not anything on the site renders italic.
 */
const FONT_SLOTS = [
  { key: 'heading', cssVariable: '--font-heading', weights: [400, 800] },
  { key: 'body', cssVariable: '--font-body', weights: [400, 700] },
];

/**
 * The custom properties a stylesheet declares.
 *
 * Passed the target site's own global.css, so "which tokens exist" is read off
 * the thing being edited rather than from a list here that would drift the first
 * time the starter gained a colour. A brief naming a token the site does not
 * declare is reported, not silently applied to nothing.
 */
export function declaredTokens(cssText) {
  const out = new Set();
  if (!cssText) return out;
  for (const m of String(cssText).matchAll(/(--[a-z0-9-]+)\s*:/gi)) out.add(m[1]);
  return out;
}

/**
 * Pull the JSON spec out of whatever was pasted.
 *
 * The paste is usually the prose brief with the spec somewhere inside it, and
 * sometimes the spec alone. Both are one code path: find every balanced `{…}`
 * that parses, keep the first that looks like a brief. Scanning for braces means
 * a spec arriving inside a fenced code block, quoted in an email, or wrapped in
 * a chat transcript is still found, and there is nothing to explain to the
 * person doing the pasting.
 */
export function extractSpec(text) {
  const s = String(text ?? '');
  if (s.length > MAX_INPUT_BYTES) return null;
  for (const start of braceStarts(s)) {
    const end = balancedEnd(s, start);
    if (end == null) continue;
    let candidate;
    try { candidate = JSON.parse(s.slice(start, end + 1)); } catch { continue; }
    if (looksLikeSpec(candidate)) return candidate;
  }
  return null;
}

/** A brief is a brief when it carries versions that name colour and type. */
export function looksLikeSpec(o) {
  if (!isObject(o)) return false;
  if (!Array.isArray(o.variations) || o.variations.length === 0) return false;
  return o.variations.some((v) => isObject(v) && (isObject(v.palette) || isObject(v.fonts)));
}

/**
 * Read a pasted brief into a plan.
 *
 * `tokens` is the set of custom properties the target site declares; pass its
 * own global.css through declaredTokens(). Omitting it accepts any `--name`,
 * which is the honest answer when there is no site yet.
 *
 * Returns `{ plan, problems }`. A problem is not on its own a reason to stop — a
 * brief with one unreadable colour is still a brief — but each one is something
 * the person who pasted it should be told, because it is a thing they chose that
 * will not appear in what they get.
 */
export function readBrief(text, { tokens = null } = {}) {
  const problems = [];
  const spec = extractSpec(text);
  if (!spec) {
    return {
      plan: null,
      problems: ['no brief found in the pasted text — expected a JSON object carrying a variations[] array whose entries name a palette or fonts'],
    };
  }

  const versions = [];
  const seenDirs = new Set();
  spec.variations.forEach((raw, i) => {
    const v = readVariation(raw, i, { tokens, problems, seenDirs });
    if (v) versions.push(v);
  });
  if (versions.length === 0) problems.push('no readable version in the brief — every variations[] entry was rejected');

  return {
    plan: {
      site: {
        name: str(spec.site?.name),
        tagline: str(spec.site?.tagline),
        purpose: str(spec.site?.purpose),
      },
      licenceRule: str(spec.licence_rule),
      versions,
      pages: readPages(spec.pages),
      content: readContentSources(spec.content, problems),
    },
    problems,
  };
}

function readVariation(raw, i, { tokens, problems, seenDirs }) {
  if (!isObject(raw)) { problems.push(`version ${i + 1}: not an object`); return null; }

  // The directory name is the one value here that becomes a filesystem path, so
  // it is taken only when it is already a plain slug — never cleaned up into
  // one. `../../etc` does not become `etc`.
  let dir = str(raw.style);
  if (!dir || !SLUG.test(dir)) {
    problems.push(`version ${i + 1}: style "${clip(dir ?? '')}" is not a plain slug — building it as version-${i + 1}/ instead`);
    dir = `version-${i + 1}`;
  }
  while (seenDirs.has(dir)) dir = `${dir}-${i + 1}`;
  seenDirs.add(dir);

  const light = readPalette(raw.palette?.light, { tokens, problems, where: `version ${i + 1} light` });
  const dark = readPalette(raw.palette?.dark, { tokens, problems, where: `version ${i + 1} dark` });
  const fonts = readFonts(raw.fonts, { problems, where: `version ${i + 1}` });

  return {
    dir,
    style: str(raw.style) ?? dir,
    styleName: str(raw.style_name),
    // Applied exactly: every value here is one the starter already declares, so
    // applying it is an edit list and nothing has to be interpreted.
    apply: { tokens: { light, dark }, fonts },
    // Interpreted, not applied. An ornament family and a layout archetype
    // describe a page structure this starter does not have, and saying so is the
    // difference between guidance and a promise the build cannot keep. The
    // reference URL is what settles it — it renders the thing they picked.
    guidance: {
      family: str(raw.family),
      layout: str(raw.layout),
      colour: str(raw.colour) ?? str(raw.colour_recipe),
      reference: httpUrl(raw.reference),
    },
  };
}

function readPalette(obj, { tokens, problems, where }) {
  const out = {};
  if (!isObject(obj)) return out;
  for (const [name, value] of Object.entries(obj).slice(0, MAX_ITEMS)) {
    if (!TOKEN_NAME.test(name)) { problems.push(`${where}: "${clip(name)}" is not a custom property name — skipped`); continue; }
    const hex = str(value);
    if (!hex || !HEX.test(hex)) { problems.push(`${where}: ${name} is "${clip(hex ?? '')}", not a hex colour — skipped`); continue; }
    if (tokens && !tokens.has(name)) { problems.push(`${where}: ${name} is not declared by the site's stylesheet, so setting it would change nothing — skipped`); continue; }
    out[name] = hex;
  }
  return out;
}

function readFonts(obj, { problems, where }) {
  const out = [];
  if (!isObject(obj)) return out;
  for (const slot of FONT_SLOTS) {
    const name = str(obj[slot.key]);
    if (!name) continue;
    if (!FONT_NAME.test(name)) { problems.push(`${where}: ${slot.key} font "${clip(name)}" is not a plain family name — skipped rather than written into a config file`); continue; }
    out.push({ name, cssVariable: slot.cssVariable, weights: slot.weights, styles: ['normal'] });
  }
  return out;
}

function readPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.slice(0, MAX_ITEMS).filter(isObject).map((p) => ({
    page: str(p.page),
    label: str(p.label) ?? str(p.page),
    standard: p.standard === true,
    referenceDesign: str(p.reference_design),
    note: str(p.note),
  })).filter((p) => p.label);
}

function readContentSources(content, problems) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const c of content.slice(0, MAX_ITEMS)) {
    if (!isObject(c)) continue;
    const url = httpUrl(c.url);
    const topic = str(c.topic);
    if (!url) { problems.push(`content "${clip(topic ?? '')}" has no fetchable https URL — skipped`); continue; }
    out.push({ topic, url, sets: Number.isFinite(c.sets) ? c.sets : null });
  }
  return out;
}

/**
 * A fetched content file, read into usable sets.
 *
 * Everything here came off the wire. A set is kept only if it carries the ten
 * fields and none of the design fields; anything else is dropped with a reason
 * rather than half-used.
 */
export function readContentFile(payload, { topic = null } = {}) {
  const problems = [];
  if (!isObject(payload) || !Array.isArray(payload.sets)) {
    return { topic, label: null, sets: [], problems: [`content for ${topic ?? 'an unnamed topic'} is not a { sets: [...] } document`] };
  }
  const sets = [];
  for (const raw of payload.sets) {
    const set = readContentSet(raw, problems);
    if (set) sets.push(set);
  }
  return { topic: str(payload.topic) ?? topic, label: str(payload.label), sets, problems };
}

function readContentSet(raw, problems) {
  if (!isObject(raw)) return null;
  const carried = FORBIDDEN_CONTENT_FIELDS.filter((f) => raw[f] != null);
  if (carried.length) {
    problems.push(`content set "${clip(str(raw.slug) ?? '?')}" carries design field(s) ${carried.join(', ')} — dropped, because the look the person chose is the one that wins`);
    return null;
  }
  const out = { slug: str(raw.slug) };
  const missing = [];
  for (const f of CONTENT_FIELDS) {
    const v = clean(raw[f]);
    if (v == null || (Array.isArray(v) && v.length === 0)) missing.push(f);
    out[f] = v;
  }
  if (missing.length) {
    problems.push(`content set "${clip(out.slug ?? '?')}" is missing ${missing.join(', ')} — dropped`);
    return null;
  }
  return out;
}

/**
 * What a content set can say about where its words came from.
 *
 * This is the honest half of a rule the payload cannot currently satisfy. The
 * licence this content ships under requires every page built from it to name the
 * work, the author and the licence, visibly. The sets carry work titles — in
 * each post's third field — and a count of the works they drew on. No author, no
 * licence, no link.
 *
 * So the block names what is there and states plainly what is not. It does not
 * infer an author from a title, and it does not quietly print a shorter list
 * than the set says exists: `declared` is the set's own count, and where that
 * exceeds the titles found, the note says so. A provenance block that looks
 * complete and is not is worse than one that admits the gap — it is the only
 * version of this that can mislead the person downstream.
 */
export function provenance(set, { licenceRule = null } = {}) {
  const works = [];
  const seen = new Set();
  for (const post of Array.isArray(set?.posts) ? set.posts : []) {
    const title = Array.isArray(post) ? str(post[2]) : null;
    if (!title || seen.has(title)) continue;
    seen.add(title);
    works.push({ title, author: null, licence: null, url: null });
  }
  const m = /(\d+)\s+(?:public[- ]domain|cc0)[^,.;]*works?/i.exec(str(set?.eyebrow) ?? '');
  const declared = m ? Number(m[1]) : null;
  return { works, declared, licence: licenceRule, note: unnamedNote(works.length, declared) };
}

function unnamedNote(found, declared) {
  const base = 'Author and licence details for each work were not supplied with this content.';
  return declared != null && declared > found
    ? `${found} of the ${declared} works this page draws on are named above. ${base}`
    : base;
}

/**
 * One content set per version, spread across the pool.
 *
 * The versions differ by look and not by words, which is the whole point — but
 * identical copy in all of them makes them harder to tell apart rather than
 * easier, and the brief asks for a different set each. Spreading rather than
 * taking the first N matters because a pool is ordered by whatever built it, so
 * its first few sets are the ones most alike.
 */
export function assignSets(versionCount, pools) {
  const queues = pools.filter((p) => p.sets.length).map((p) => ({ topic: p.topic, sets: p.sets, taken: 0 }));
  if (!queues.length) return new Array(versionCount).fill(null);
  // How many versions each topic will be asked for, so the stride below spans
  // that topic's whole pool rather than a prefix of it.
  const perTopic = Math.ceil(versionCount / queues.length);
  const out = [];
  for (let n = 0; n < versionCount; n++) {
    const q = queues[n % queues.length];
    const idx = perTopic > 1 ? Math.round((q.taken * (q.sets.length - 1)) / (perTopic - 1)) : 0;
    q.taken++;
    out.push({ topic: q.topic, set: q.sets[Math.min(idx, q.sets.length - 1)] });
  }
  return out;
}

// --- small helpers ----------------------------------------------------------

function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * A string from the paste, made safe to put in a file.
 *
 * Control characters go — they rewrite a terminal line and break out of a JSON
 * string when re-serialised — whitespace collapses, and the result is capped.
 * Returns null for anything that is not a non-empty string, so a caller testing
 * the value gets one answer rather than three.
 */
function str(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > MAX_STRING ? s.slice(0, MAX_STRING - 1) + '…' : s;
}

/** str(), applied through the one level of nesting a content set uses. */
function clean(v) {
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v.slice(0, MAX_ITEMS)) {
      if (typeof item === 'string') { const s = str(item); if (s) out.push(s); }
      else if (Array.isArray(item)) {
        const row = item.slice(0, MAX_ITEMS).map((cell) => str(cell)).filter((cell) => cell != null);
        if (row.length) out.push(row);
      }
    }
    return out;
  }
  return null;
}

/** An https URL, or null. Plain http is not fetched: a brief travels over chat. */
function httpUrl(v) {
  const s = str(v);
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  return u.protocol === 'https:' ? u.href : null;
}

function clip(s) { return String(s).slice(0, 60); }

function* braceStarts(s) {
  for (let i = 0; i < s.length; i++) if (s[i] === '{') yield i;
}

/** The index of the `}` closing the `{` at `start`, respecting JSON strings. */
function balancedEnd(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return null;
}
