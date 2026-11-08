// Run with: node --test scripts/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { minifySvg } from "./svg-minify.mjs";

// The few matchers this suite needs, on top of node:assert.
const expect = (actual, message) => ({
  toBe: (expected) => assert.equal(actual, expected, message),
  toBeNull: () => assert.equal(actual, null, message),
  toContain: (part) =>
    assert.ok(actual.includes(part), message ?? `expected to contain ${part}`),
  toThrow: () => assert.throws(actual, message),
  not: {
    toContain: (part) =>
      assert.ok(!actual.includes(part), message ?? `unexpected ${part}`),
  },
});

const inkscape = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg
   width="64"
   height="64"
   viewBox="0 0 64 64"
   version="1.1"
   id="svg5"
   inkscape:version="1.2 (dc2aedaf03, 2022-05-15)"
   sodipodi:docname="logo.svg"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns:xlink="http://www.w3.org/1999/xlink"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sodipodi:namedview
     id="namedview7"
     pagecolor="#ffffff"><inkscape:grid type="xygrid" /></sodipodi:namedview>
  <metadata><rdf:RDF><dc:title>Logo</dc:title></rdf:RDF></metadata>
  <defs>
    <style><![CDATA[ .a { fill: #123 } ]]></style>
    <linearGradient id="g" inkscape:collect="always"><stop offset="0" stop-color="#fff"/></linearGradient>
  </defs>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" data-name="Layer 1">
    <path class="a" d="M 10,10
       L 20,20 Z" style="fill:url(#g)" />
    <use xlink:href="#g" />
    <text x="0" y="9"><tspan>Home</tspan> <tspan>Grid</tspan></text>
  </g>
</svg>
`;

describe("minifySvg", () => {
  it("removes editor data and whitespace but keeps the artwork byte for byte", () => {
    expect(minifySvg(inkscape)).toBe(
      '<svg width="64" height="64" viewBox="0 0 64 64" version="1.1" id="svg5" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg">' +
        "<defs><style><![CDATA[ .a { fill: #123 } ]]></style>" +
        '<linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<g><path class="a" d="M 10,10\n       L 20,20 Z" style="fill:url(#g)"/>' +
        '<use xlink:href="#g"/>' +
        '<text x="0" y="9"><tspan>Home</tspan> <tspan>Grid</tspan></text></g></svg>',
    );
  });

  it("is idempotent and keeps the same document structure", () => {
    const once = minifySvg(inkscape);
    expect(minifySvg(once)).toBe(once);
    // Count elements and compare path data without a DOM implementation.
    const count = (svg, tag) =>
      (svg.match(new RegExp(`<${tag}[\\s/>]`, "g")) ?? []).length;
    for (const tag of ["path", "use", "text", "linearGradient", "stop"])
      expect(count(once, tag), tag).toBe(count(inkscape, tag));
    const pathData = (svg) => svg.match(/\sd="([^"]*)"/)?.[1];
    expect(pathData(once)).toBe(pathData(inkscape));
    const text = once.match(/<text\b[^>]*>([\s\S]*?)<\/text>/)?.[1] ?? "";
    expect(text.replace(/<[^>]+>/g, "")).toBe("Home Grid");
  });

  it("keeps whitespace under xml:space and data attributes a stylesheet uses", () => {
    expect(
      minifySvg(
        '<svg viewBox="0 0 1 1" xml:space="preserve">\n  <g> </g>\n</svg>',
      ),
    ).toBe('<svg viewBox="0 0 1 1" xml:space="preserve">\n  <g> </g>\n</svg>');
    expect(
      minifySvg(
        '<svg viewBox="0 0 1 1"><style>[data-x] { fill: red }</style><rect data-x="1"/></svg>',
      ),
    ).toContain('data-x="1"');
  });

  it("keeps prefixes that are not exclusively bound to an editor namespace", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:i="urn:example" viewBox="0 0 1 1"><g i:keep="1"/></svg>';
    expect(minifySvg(svg)).toBe(svg);
  });

  it("rejects markup it cannot reproduce faithfully", () => {
    for (const svg of [
      // Removing the comment must not be able to assemble a new tag.
      "<svg><scr<!-- -->ipt>alert(1)</script></svg>",
      '<svg viewBox="0 0 1 1"><g></svg>',
      "<svg viewBox=0></svg>",
      '<svg a="1" a="2"></svg>',
      "<svg></svg><svg></svg>",
      "text<svg></svg>",
      "<svg><!-- unterminated </svg>",
      "",
    ])
      expect(() => minifySvg(svg), svg).toThrow();
  });
});

it("normalizes line endings the way XML parsers do", () => {
  expect(
    minifySvg(
      '<svg viewBox="0 0 1 1">\r\n<path d="M0 0\r\nL1 1\rZ"/>\r\n</svg>',
    ),
  ).toBe('<svg viewBox="0 0 1 1"><path d="M0 0\nL1 1\nZ"/></svg>');
});
