// =============================================================================
// Turning a pasted URL into a real link.
//
// A URL pasted into a comment or a description used to be dead text — you
// could read it, but not click it, so people copied it back out by hand
// (Ray, 2026-09-16: "make sure pasting a url formats as a url in all comment
// and description fields").
//
// TWO ENTRY POINTS, because the two paths hand text over differently:
//
//  - `linkifyEscaped(html)` — for a fragment that has ALREADY been HTML-escaped
//    (the comment and description builders escape first, then assemble). It
//    must not escape again, or `&amp;` in a query string becomes `&amp;amp;`.
//  - `linkifyHtml(html)` — for real markup (the rich-text editor's output).
//    Walks TEXT NODES only, so it can't linkify inside an existing `<a href>`
//    or any other attribute.
//
// Both emit the same `<a target="_blank" rel="noopener noreferrer">` shape the
// sanitiser already allows, so nothing needs to change there.
//
// **Only http:// and https://.** Deliberately not a bare-domain matcher
// ("www.foo.com", "foo.co.uk"): these fields are full of part numbers,
// file names and abbreviations, and guessing at what looks domain-shaped is
// how "ALT.III" or "REV.2" becomes a broken link. A pasted URL carries its
// scheme, which is the signal worth trusting. `javascript:` and `data:` are
// not matched at all, and would be stripped by the sanitiser regardless.
// =============================================================================

/**
 * A URL with an explicit http/https scheme.
 *
 * The trailing character class excludes what usually follows a URL in prose
 * rather than belonging to it — a full stop ending the sentence, a closing
 * bracket, a comma. `&` is allowed inside (query strings need it) but the
 * escaped form `&amp;` is handled by the trimming below.
 */
const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Trailing punctuation that is almost always the sentence's, not the URL's.
 *
 * "See https://x.com/page." — the full stop is the writer's. Kept OUT of the
 * href and re-emitted after the link, so the text still reads correctly.
 * A closing paren is only trimmed when unbalanced, so a Wikipedia-style
 * `..._(disambiguation)` URL survives intact.
 */
function splitTrailing(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = "";
  for (;;) {
    // ENTITY FIRST. Stripping punctuation first eats the ";" off "&quot;",
    // which then no longer matches as an entity and leaves "&quot" welded to
    // the href — found by test, 2026-09-16.
    const entity = /&(?:amp|quot|#39|lt|gt);$/.exec(href);
    if (entity) {
      trailing = entity[0] + trailing;
      href = href.slice(0, -entity[0].length);
      continue;
    }
    const last = href.slice(-1);
    if (".,;:!?".includes(last)) {
      trailing = last + trailing;
      href = href.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(href, "(") < countChar(href, ")")) {
      trailing = last + trailing;
      href = href.slice(0, -1);
      continue;
    }
    break;
  }
  return { href, trailing };
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n += 1;
  return n;
}

/** The anchor, with the attributes the sanitiser allows. */
function anchor(href: string, text: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

/**
 * Linkify a fragment that is already HTML-escaped.
 *
 * The href and the visible text are both the escaped form, which is correct:
 * the escaping is what makes `&` safe in an attribute, and a browser resolves
 * `&amp;` back to `&` when following the link.
 */
export function linkifyEscaped(escaped: string): string {
  if (!escaped) return "";
  return escaped.replace(URL_RE, (match) => {
    const { href, trailing } = splitTrailing(match);
    // Nothing left after trimming (a bare "https://") isn't a link.
    if (!/^https?:\/\/[^/]/.test(href)) return match;
    return anchor(href, href) + trailing;
  });
}

/**
 * Linkify real markup, walking TEXT NODES only.
 *
 * A string replace over HTML would match a URL inside an `href` and nest an
 * anchor inside an anchor. Skipping `<a>` contents also means a link the user
 * made themselves (or one the rich editor created) is left alone.
 */
export function linkifyHtml(html: string): string {
  if (!html.trim()) return html;
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const parent = text.parentElement;
    // Never inside an existing link, and never inside a mention chip.
    if (parent && !parent.closest("a") && !parent.closest("span.mention")) {
      targets.push(text);
    }
    node = walker.nextNode();
  }

  for (const text of targets) {
    const value = text.nodeValue ?? "";
    const re = new RegExp(URL_RE.source, "g");
    if (!re.test(value)) continue;
    re.lastIndex = 0;

    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      const { href, trailing } = splitTrailing(match[0]);
      if (!/^https?:\/\/[^/]/.test(href)) continue;
      if (match.index > lastIndex) {
        fragment.appendChild(doc.createTextNode(value.slice(lastIndex, match.index)));
      }
      const a = doc.createElement("a");
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.textContent = href;
      fragment.appendChild(a);
      if (trailing) fragment.appendChild(doc.createTextNode(trailing));
      lastIndex = re.lastIndex;
    }
    if (lastIndex === 0) continue;
    if (lastIndex < value.length) {
      fragment.appendChild(doc.createTextNode(value.slice(lastIndex)));
    }
    text.parentNode?.replaceChild(fragment, text);
  }

  return doc.body.innerHTML;
}
