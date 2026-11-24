import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { OpenItemsBar } from "./OpenItemsBar";
import { keepOpen, useOpenItems } from "@/hooks/useOpenItems";

// =============================================================================
// The strip under the header (BusinessIT#74). Dragging can't be driven in
// jsdom — dnd-kit's pointer sensor needs layout — so the drop rule is tested
// in lib/openItems.test.ts (moveOpenItem) and the drag itself was checked in
// a real browser. The keyboard reorder runs here.
// =============================================================================

const ITEMS = [
  { path: "/task/3", label: "T3-0017-Harness", category: "Engineering Tasks" },
  { path: "/eir/7", label: "EIR_2026-0007 — CM4 BOM", category: "EIRs" },
  { path: "/build-request/9", label: "BR_2026-0009", category: "Build Requests" },
];

function seed() {
  act(() => {
    for (const item of ITEMS) keepOpen(item);
  });
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function Order() {
  return <p data-testid="order">{useOpenItems().map((i) => i.path).join(" ")}</p>;
}

function renderStrip(route = "/eir/7") {
  return renderWithProviders(
    <>
      <OpenItemsBar />
      <Where />
      <Order />
    </>,
    { route },
  );
}

const originalWidth = window.innerWidth;
afterEach(() => {
  window.innerWidth = originalWidth;
});

describe("OpenItemsBar", () => {
  it("renders nothing when nothing is kept open", () => {
    renderStrip();
    expect(screen.queryByTestId("open-items-bar")).not.toBeInTheDocument();
  });

  it("shows a tab per kept record, in order, with the current page marked", () => {
    seed();
    renderStrip("/eir/7");
    const tabs = within(screen.getByRole("navigation", { name: "Kept open" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(ITEMS.map((i) => i.label));
    expect(tabs[1]).toHaveAttribute("aria-current", "page");
    expect(tabs[0]).not.toHaveAttribute("aria-current");
    expect(tabs[0]).toHaveAttribute("title", expect.stringContaining("Engineering Tasks: T3-0017-Harness"));
  });

  it("opens a record when its tab is clicked", async () => {
    const user = userEvent.setup();
    seed();
    renderStrip("/eir/7");
    await user.click(screen.getByRole("link", { name: "T3-0017-Harness" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/task/3");
  });

  it("closing the current page's tab keeps you on the page", async () => {
    const user = userEvent.setup();
    seed();
    renderStrip("/eir/7");
    await user.click(screen.getByRole("button", { name: "Close EIR_2026-0007 — CM4 BOM" }));
    expect(screen.queryByRole("link", { name: "EIR_2026-0007 — CM4 BOM" })).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/eir/7");
    expect(screen.getByTestId("order")).toHaveTextContent("/task/3 /build-request/9");
  });

  it("Ctrl+Shift+arrow moves the focused tab and keeps it focused", () => {
    seed();
    renderStrip();
    const tab = screen.getByRole("link", { name: "T3-0017-Harness" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("order")).toHaveTextContent("/eir/7 /task/3 /build-request/9");
    expect(screen.getByRole("link", { name: "T3-0017-Harness" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("link", { name: "T3-0017-Harness" }), {
      key: "ArrowLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getByTestId("order")).toHaveTextContent("/task/3 /eir/7 /build-request/9");
  });

  it("a plain arrow key, or Ctrl alone, moves nothing", () => {
    seed();
    renderStrip();
    const tab = screen.getByRole("link", { name: "T3-0017-Harness" });
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    fireEvent.keyDown(tab, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(tab, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("order")).toHaveTextContent("/task/3 /eir/7 /build-request/9");
  });

  it("on a phone, is one Open (n) menu with the same list", async () => {
    window.innerWidth = 375;
    const user = userEvent.setup();
    seed();
    renderStrip("/eir/7");
    expect(screen.queryByRole("navigation", { name: "Kept open" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /open \(3\)/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const current = screen.getByRole("link", { name: /EIR_2026-0007/ });
    expect(current).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: /T3-0017-Harness/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/task/3");
    expect(screen.getByRole("button", { name: /open \(3\)/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("on a phone, Escape closes the menu", async () => {
    window.innerWidth = 375;
    const user = userEvent.setup();
    seed();
    renderStrip();
    await user.click(screen.getByRole("button", { name: /open \(3\)/i }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("link", { name: /T3-0017-Harness/ })).not.toBeInTheDocument();
  });
});
