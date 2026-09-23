import DOMPurify from "dompurify";
import { linkifyHtml } from "./linkify";

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

/**
 * Sanitise, and turn any bare URL into a real link.
 *
 * **Linkifying lives HERE so it is universal** (Ray, 2026-09-16: "make that
 * universal across arc"). Every place ARC renders stored rich text goes
 * through this one function — comment threads, task and EIR descriptions, the
 * ECN / Gray Market / Cost Impact / Customer Note detail cards, and both
 * print views — so wiring each call site individually would have been a dozen
 * edits and a standing invitation to miss the next one.
 *
 * It happens on READ, not on write, which means it also reaches the thousands
 * of comments and descriptions saved before this existed. Nothing is migrated
 * and nothing stored changes.
 *
 * Order matters: linkify FIRST, then sanitise, so the anchors this adds are
 * filtered by exactly the same rules as any other markup rather than being
 * trusted because we made them.
 */
export function sanitiseHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return DOMPurify.sanitize(linkifyHtml(raw), {
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
