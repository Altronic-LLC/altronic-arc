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
// allow target/rel on links, and the data-email attribute on mention chips
// so we can later extract recipients for email notifications
const ADD_ATTR = ["target", "rel", "data-email"];

export function sanitiseHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return DOMPurify.sanitize(raw, {
    ADD_TAGS,
    ADD_ATTR,
    USE_PROFILES: { html: true },
    // Forbid the obviously-dangerous stuff explicitly even though the html
    // profile already blocks them. Defense in depth.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    // Drop `style` and any explicit `color` / `bgcolor`. The Power Apps
    // rich-text editor stamps `color: rgb(0,0,0)` on every paragraph it
    // produces, which renders as unreadable black on the dark theme.
    // Letting the theme own colour is the right call: text inherits
    // `color: rgb(var(--fg))` from the parent and always contrasts.
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "style",
      "color",
      "bgcolor",
    ],
  });
}
