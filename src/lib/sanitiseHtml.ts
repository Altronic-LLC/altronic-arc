import DOMPurify from "dompurify";

/**
 * Sanitise HTML coming from SharePoint (comments and descriptions) before
 * rendering with dangerouslySetInnerHTML.
 *
 * Allows common formatting/structural tags (paragraphs, lists, emphasis,
 * links, line breaks, basic tables) and strips scripts, event handlers,
 * inline iframes, and javascript: URLs. The default DOMPurify config is
 * already strict; we just lock in a few options explicitly.
 *
 * If the SharePoint Communication field ever needs to support new tags
 * (e.g. <video> for embedded recordings), add them to ADD_TAGS below.
 */
const ADD_TAGS = ["u"]; // <u> is non-standard but appears in SP comments
const ADD_ATTR = ["target", "rel"]; // allow target="_blank" on links

export function sanitiseHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return DOMPurify.sanitize(raw, {
    ADD_TAGS,
    ADD_ATTR,
    USE_PROFILES: { html: true },
    // Forbid the obviously-dangerous stuff explicitly even though the html
    // profile already blocks them. Defense in depth.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
