import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { buildMirroredBody } from "@/lib/commentMirror";
import { useCommentOriginLink } from "./useCommentOriginLink";

// =============================================================================
// The "open the part to reply" link routes; it does NOT reload the page.
//
// A mirrored comment's banner is stored HTML rendered through
// dangerouslySetInnerHTML, so its anchor sits outside React's tree. Clicked
// as-is it triggers a full page load — the bundle re-downloads, the MSAL
// cache is re-read, and anything half-typed elsewhere is gone.
// =============================================================================

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

/** A comment body as it is really stored and really rendered. */
function Harness({ body }: { body: string }) {
  const onClick = useCommentOriginLink();
  return (
    <div
      className="comment-html"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: sanitiseHtml(body) }}
    />
  );
}

function renderBody(body: string) {
  return render(
    <MemoryRouter>
      <Harness body={body} />
    </MemoryRouter>,
  );
}

const MIRRORED = buildMirroredBody('<p>out of tolerance</p>', {
  kind: "buildRequestItem",
  id: 7,
  label: "371601-02",
  parentLabel: "BR_2026-1016",
});

beforeEach(() => navigate.mockClear());

describe("the origin banner's jump link", () => {
  it("routes to the part instead of reloading", async () => {
    renderBody(MIRRORED);
    await userEvent.click(screen.getByRole("link", { name: /open the part to reply/i }));
    expect(navigate).toHaveBeenCalledWith("/build-request-item/7");
  });

  it("says where the comment came from, in words", async () => {
    // Not colour-only: this survives a mono print and a screen reader.
    renderBody(MIRRORED);
    expect(
      screen.getByText(/Posted on part 371601-02 of build request BR_2026-1016/),
    ).toBeInTheDocument();
  });

  it("still shows the original comment body", async () => {
    renderBody(MIRRORED);
    expect(screen.getByText("out of tolerance")).toBeInTheDocument();
  });
});

describe("what it leaves alone", () => {
  it("does NOT intercept an ordinary link in a comment", async () => {
    // A pasted URL is linkified by sanitiseHtml and must keep its normal
    // browser behaviour, target="_blank" included.
    renderBody("<p>see https://example.com/page for detail</p>");
    await userEvent.click(screen.getByRole("link"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does NOT intercept a click on the body text", async () => {
    renderBody(MIRRORED);
    await userEvent.click(screen.getByText("out of tolerance"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves a MODIFIED click to the browser, for a new tab or window", async () => {
    // Swallowing a deliberate open-elsewhere is exactly the complaint that
    // started the draft-persistence work (Alexander Masgras wanted
    // ctrl+click on Back).
    //
    // Driven with fireEvent, NOT userEvent: `userEvent.keyboard("{Control>}")`
    // holds the key for KEYBOARD events but does not stamp `ctrlKey` onto the
    // synthetic click, so a userEvent-driven version of this passes whether
    // the modifier guard exists or not. Verified by deleting the guard and
    // watching each case below fail.
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const) {
      navigate.mockClear();
      const { unmount } = renderBody(MIRRORED);
      fireEvent.click(screen.getByRole("link", { name: /open the part to reply/i }), {
        [modifier]: true,
      });
      expect(navigate, modifier).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("leaves a MIDDLE click to the browser", async () => {
    renderBody(MIRRORED);
    fireEvent.click(screen.getByRole("link", { name: /open the part to reply/i }), {
      button: 1,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("intercepts a plain left click — the case that matters", async () => {
    // Pinned alongside the exemptions above so the guard can't be widened
    // into "never intercept anything".
    renderBody(MIRRORED);
    fireEvent.click(screen.getByRole("link", { name: /open the part to reply/i }), {
      button: 0,
    });
    expect(navigate).toHaveBeenCalledWith("/build-request-item/7");
  });
});
