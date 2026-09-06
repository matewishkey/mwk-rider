// A YAML subset, enough for this directory's case files — and no more.
//
// The repo ships zero dependencies and has no package.json at its root, so
// there is nothing to `npm install` a real parser from. What the cases actually
// use is small and regular: nested maps, block and flow sequences, quoted and
// bare scalars, `|` and `>-` block scalars, and comments. That is what this
// reads.
//
// It is a SUBSET on purpose. Anchors, aliases, multi-document streams, tags,
// complex keys and flow mappings are not supported and never silently
// mis-parsed — `parseYaml` throws on structure it does not understand rather
// than returning something plausible, because a case file that parses wrong is
// a test that asserts the wrong thing.

const DEDENT = /^(\s*)/;
const indentOf = (line) => DEDENT.exec(line)[1].length;

/** Strip a trailing `# comment`, respecting quotes. */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const body = s.slice(1, -1);
    return s[0] === '"' ? body.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : body.replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    // Flow sequences here only ever hold scalars, which is why a naive split is safe.
    return splitFlow(inner).map(scalar);
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

function splitFlow(s) {
  const out = []; let cur = ''; let quote = null;
  for (const c of s) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Read a `|` / `>` block scalar starting at `i`; returns [value, nextIndex]. */
function blockScalar(lines, i, parentIndent, style) {
  const body = [];
  let j = i;
  let blockIndent = null;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') { body.push(''); continue; }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (blockIndent === null) blockIndent = ind;
    body.push(line.slice(blockIndent));
  }
  while (body.length && body[body.length - 1] === '') body.pop();
  const folded = style.startsWith('>');
  let text = folded
    ? body.reduce((acc, l) => (l === '' ? `${acc}\n` : acc && !acc.endsWith('\n') ? `${acc} ${l}` : acc + l), '')
    : body.join('\n');
  if (style.endsWith('-')) text = text.replace(/\n+$/, '');
  else if (!folded) text += '\n';
  return [text, j];
}

// The child's indentation is DISCOVERED from its first line, not predicted from
// the parent's. Passing an exact expected indent is the obvious approach and it
// is wrong: YAML only requires a child to be more indented than its parent, not
// more indented by any particular amount.
function parseBlock(lines, start, minIndent) {
  let i = start;
  while (i < lines.length && (lines[i].trim() === '' || COMMENT_LINE.test(lines[i]))) i++;
  if (i >= lines.length) return [null, i];
  const ind = indentOf(lines[i]);
  if (ind < minIndent) return [null, start];
  const isSeq = lines[i].trim() === '-' || lines[i].trim().startsWith('- ');
  return isSeq ? parseSeq(lines, i, ind) : parseMap(lines, i, ind);
}

function parseSeq(lines, start, indent) {
  const out = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || COMMENT_LINE.test(line)) { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`yaml: unexpected indent at line ${i + 1}: ${line}`);
    const item = stripComment(line).trim();
    if (!item.startsWith('-')) break;
    const rest = item.slice(1).trim();
    if (rest === '') { const [v, ni] = parseBlock(lines, i + 1, indent + 1); out.push(v); i = ni; continue; }
    // `- key: value` opens a map whose FIRST key sits on the dash line and whose
    // remaining keys are indented past it. Rewriting the dash as spaces turns
    // the item into an ordinary map block, which is the one place a naive
    // parser silently drops everything after the first key.
    if (/^[A-Za-z_][\w.-]*\s*:/.test(rest)) {
      const sub = lines.slice(i);
      sub[0] = ' '.repeat(ind + 2) + rest;
      const [v, consumed] = parseMap(sub, 0, ind + 2);
      out.push(v);
      i += consumed;
      continue;
    }
    out.push(scalar(rest));
    i++;
  }
  return [out, i];
}

function parseMap(lines, start, indent) {
  const out = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || COMMENT_LINE.test(line)) { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`yaml: unexpected indent at line ${i + 1}: ${line}`);
    const trimmed = stripComment(line).trim();
    if (trimmed === '') { i++; continue; }
    if (trimmed.startsWith('- ')) break;
    const m = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!m) throw new Error(`yaml: cannot parse line ${i + 1}: ${line}`);
    const [, key, rawValue] = m;
    if (rawValue === '|' || rawValue === '|-' || rawValue === '>' || rawValue === '>-') {
      const [text, ni] = blockScalar(lines, i + 1, ind, rawValue);
      out[key] = text; i = ni; continue;
    }
    if (rawValue === '') {
      const [value, ni] = parseBlock(lines, i + 1, ind + 1);
      out[key] = value; i = ni; continue;
    }
    out[key] = scalar(rawValue);
    i++;
  }
  return [out, i];
}

/** Parse a YAML document (the subset above) into a plain object. */
export function parseYaml(text) {
  // Whole-line comments are skipped where STRUCTURE is read (parseMap, parseSeq,
  // parseBlock), never here. Filtering the raw text first is the obvious version
  // and it silently eats content: a `# heading` line inside a `prompt: |` body
  // is literal text, and dropping it rewrote the prompt an eval sends without
  // reporting anything — the one failure this parser exists to refuse.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const [value] = parseBlock(lines, 0, 0);
  return value ?? {};
}

/** A whole-line comment, which is structure, not content. */
const COMMENT_LINE = /^\s*#/;

/** Split `---\nfrontmatter\n---\nbody` into `{ meta, body }`. */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { meta: {}, body: text };
  return { meta: parseYaml(m[1]), body: m[2] };
}
