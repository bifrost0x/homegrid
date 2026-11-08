// Size reduction for bundled SVG logos without touching the artwork.
//
// The document is tokenized (comments, CDATA, processing instructions,
// declarations, tags and text) and written back with:
//   - comments, processing instructions (including the XML declaration) and
//     <metadata> removed;
//   - elements and attributes in editor namespaces (Inkscape, Sodipodi,
//     Sketch, Serif, Adobe Illustrator, Boxy SVG, Vectornator) removed, along
//     with namespace declarations nothing uses any more;
//   - data-* attributes removed unless a stylesheet mentions them;
//   - line endings normalized to LF, as every XML parser does on input;
//   - whitespace between attributes collapsed and whitespace-only text between
//     elements dropped, except inside text content, <title>, <desc>, <style>
//     or anything under xml:space="preserve".
// Attribute values, path data, CDATA and every other character of content
// are copied unchanged. Anything the tokenizer does not understand throws, so
// the caller can reject the file instead of shipping a guess.

const EDITOR_NAMESPACES = new Set([
  "http://www.inkscape.org/namespaces/inkscape",
  "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://www.bohemiancoding.com/sketch/ns",
  "http://www.serif.com/",
  "http://ns.adobe.com/AdobeIllustrator/10.0/",
  "http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/",
  "http://ns.adobe.com/Extensibility/1.0/",
  "http://ns.adobe.com/Flows/1.0/",
  "http://ns.adobe.com/Graphs/1.0/",
  "http://ns.adobe.com/ImageReplacement/1.0/",
  "http://ns.adobe.com/SaveForWeb/1.0/",
  "http://ns.adobe.com/Variables/1.0/",
  "http://ns.adobe.com/GenericCustomNamespace/1.0/",
  "http://ns.adobe.com/XPath/1.0/",
  "https://boxy-svg.com",
  "http://vectornator.io",
]);

// Whitespace inside these elements is content (or may be), so text nodes
// below them are kept byte for byte.
const TEXT_ELEMENTS = new Set([
  "text",
  "tspan",
  "textPath",
  "tref",
  "altGlyph",
  "title",
  "desc",
  "style",
  "script",
  "foreignObject",
]);

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /[ \t\r\n]*/y;

function fail(message, index) {
  throw new Error(`${message} at offset ${index}`);
}

function readName(text, index) {
  NAME.lastIndex = index;
  const match = NAME.exec(text);
  if (!match) fail("expected a name", index);
  return match[0];
}

function skipSpace(text, index) {
  SPACE.lastIndex = index;
  SPACE.exec(text);
  return SPACE.lastIndex;
}

function readDeclaration(text, start) {
  // <!DOCTYPE ...> may carry an internal subset in brackets.
  let depth = 0;
  for (let i = start + 2; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, i + 1);
      if (end < 0) break;
      i = end;
    } else if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === ">" && depth <= 0) return i + 1;
  }
  return fail("unterminated declaration", start);
}

function readTag(text, start) {
  let index = start + 1;
  const closing = text[index] === "/";
  if (closing) index++;
  const name = readName(text, index);
  index += name.length;
  const attributes = [];
  for (;;) {
    const afterSpace = skipSpace(text, index);
    const char = text[afterSpace];
    if (char === ">")
      return {
        tag: { name, closing, attributes, selfClosing: false },
        end: afterSpace + 1,
      };
    if (char === "/" && text[afterSpace + 1] === ">" && !closing)
      return {
        tag: { name, closing, attributes, selfClosing: true },
        end: afterSpace + 2,
      };
    if (closing || afterSpace === index)
      fail(`malformed tag <${name}>`, afterSpace);
    const attribute = readName(text, afterSpace);
    index = skipSpace(text, afterSpace + attribute.length);
    if (text[index] !== "=") fail(`attribute ${attribute} has no value`, index);
    index = skipSpace(text, index + 1);
    const quote = text[index];
    if (quote !== '"' && quote !== "'")
      fail(`attribute ${attribute} is not quoted`, index);
    const close = text.indexOf(quote, index + 1);
    if (close < 0) fail(`unterminated attribute ${attribute}`, index);
    const value = text.slice(index + 1, close);
    if (value.includes("<")) fail(`attribute ${attribute} contains <`, index);
    if (attributes.some((existing) => existing.name === attribute))
      fail(`duplicate attribute ${attribute}`, index);
    attributes.push({ name: attribute, quote, value });
    index = close + 1;
  }
}

export function tokenizeSvg(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "<") {
      const next = text.indexOf("<", index);
      const end = next < 0 ? text.length : next;
      tokens.push({ type: "text", value: text.slice(index, end) });
      index = end;
    } else if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0) fail("unterminated comment", index);
      index = end + 3;
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index + 9);
      if (end < 0) fail("unterminated CDATA section", index);
      tokens.push({ type: "cdata", value: text.slice(index, end + 3) });
      index = end + 3;
    } else if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0) fail("unterminated processing instruction", index);
      index = end + 2;
    } else if (text.startsWith("<!", index)) {
      const end = readDeclaration(text, index);
      tokens.push({ type: "declaration", value: text.slice(index, end) });
      index = end;
    } else {
      const { tag, end } = readTag(text, index);
      tokens.push({ type: "tag", ...tag });
      index = end;
    }
  }
  return tokens;
}

const prefixOf = (name) => {
  const colon = name.indexOf(":");
  return colon > 0 ? name.slice(0, colon) : "";
};
const localName = (name) => name.slice(name.indexOf(":") + 1);

export function minifySvg(input) {
  // XML parsers read CRLF and CR as LF, so normalizing them is invisible to
  // the renderer and keeps the files stable under git line-ending rules.
  const text = (
    input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  ).replace(/\r\n?/g, "\n");
  const tokens = tokenizeSvg(text);

  // Prefixes bound to an editor namespace, and only ever to one.
  const bindings = new Map();
  for (const token of tokens)
    if (token.type === "tag" && !token.closing)
      for (const { name, value } of token.attributes)
        if (name.startsWith("xmlns:")) {
          const prefix = name.slice(6);
          bindings.set(prefix, [...(bindings.get(prefix) ?? []), value]);
        }
  const editorPrefixes = new Set(
    [...bindings]
      .filter(([, uris]) => uris.every((uri) => EDITOR_NAMESPACES.has(uri)))
      .map(([prefix]) => prefix),
  );
  // A stylesheet could select on data-* attributes; keep them all if any
  // stylesheet so much as mentions one.
  const keepData = [...text.matchAll(/<style\b[\s\S]*?<\/style>/gi)].some(
    ([style]) => /data-/i.test(style),
  );

  const kept = [];
  const stack = [];
  let skipping = 0;
  let roots = 0;
  for (const token of tokens) {
    if (token.type === "tag" && token.closing) {
      if (skipping) {
        skipping--;
        continue;
      }
      const open = stack.pop();
      if (open?.name !== token.name)
        throw new Error(`unexpected </${token.name}>`);
      kept.push(token);
      continue;
    }
    if (skipping) {
      if (token.type === "tag" && !token.selfClosing) skipping++;
      continue;
    }
    if (token.type === "tag") {
      const prefix = prefixOf(token.name);
      if (
        editorPrefixes.has(prefix) ||
        (!prefix && token.name === "metadata")
      ) {
        if (!token.selfClosing) skipping = 1;
        continue;
      }
      if (!stack.length && roots++)
        throw new Error("more than one root element");
      const attributes = token.attributes.filter(({ name }) => {
        if (editorPrefixes.has(prefixOf(name))) return false;
        if (name.startsWith("xmlns:") && editorPrefixes.has(name.slice(6)))
          return false;
        return keepData || !/^data-/i.test(name);
      });
      const preserve =
        TEXT_ELEMENTS.has(localName(token.name)) ||
        attributes.some(
          ({ name, value }) => name === "xml:space" && value === "preserve",
        ) ||
        !!stack.at(-1)?.preserve;
      kept.push({ ...token, attributes });
      if (!token.selfClosing) stack.push({ name: token.name, preserve });
      continue;
    }
    if (token.type === "declaration") {
      if (stack.length || roots) throw new Error("misplaced declaration");
      kept.push(token);
      continue;
    }
    const blank = token.type === "text" && !/[^ \t\r\n]/.test(token.value);
    if (!stack.length) {
      if (blank) continue;
      throw new Error("content outside the root element");
    }
    if (blank && !stack.at(-1).preserve) continue;
    kept.push(token);
  }
  if (skipping || stack.length) throw new Error("unclosed element");
  if (!roots) throw new Error("no root element");

  // Drop namespace declarations that nothing refers to any more.
  const used = new Set();
  for (const token of kept)
    if (token.type === "tag") {
      used.add(prefixOf(token.name));
      for (const { name } of token.attributes)
        if (!name.startsWith("xmlns")) used.add(prefixOf(name));
    }
  const content = kept
    .filter((token) => token.type !== "tag")
    .map((token) => token.value)
    .join("\n");

  let output = "";
  for (const token of kept) {
    if (token.type !== "tag") {
      output += token.value;
      continue;
    }
    if (token.closing) {
      output += `</${token.name}>`;
      continue;
    }
    output += `<${token.name}`;
    for (const { name, quote, value } of token.attributes) {
      if (name.startsWith("xmlns:")) {
        const prefix = name.slice(6);
        if (!used.has(prefix) && !content.includes(prefix + ":")) continue;
      }
      output += ` ${name}=${quote}${value}${quote}`;
    }
    output += token.selfClosing ? "/>" : ">";
  }
  return output;
}
