import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MultiSelect,
  PANEL_MAX_HEIGHT,
  choosePanelPlacement,
  type SelectOption,
} from "./SearchableSelect";
import { resetOpenDropdown } from "./useDropdownClose";

/**
 * BusinessIT#66 — a dropdown near the bottom of a short page opened under the
 * fixed footer, with its options out of reach (the task page's Watchers
 * picker). It now opens above when there's more room there.
 */

const VIEWPORT = 800;

function rect(top: number, height = 40) {
  return { top, bottom: top + height, left: 100, width: 300 };
}

describe("choosePanelPlacement", () => {
  it("opens below when the whole panel fits above the footer", () => {
    expect(choosePanelPlacement(rect(100), 736)).toEqual({ side: "below" });
  });

  it("opens ABOVE when the trigger sits just over the footer", () => {
    // Trigger 600–640, footer at 736: 84px below, 588px above.
    const p = choosePanelPlacement(rect(600), 736);
    expect(p.side).toBe("above");
    if (p.side !== "above") return;
    expect(p.maxHeight).toBe(PANEL_MAX_HEIGHT);
    // Anchored 4px over the trigger's top edge, in viewport terms.
    expect(p.bottom).toBe(window.innerHeight - 600 + 4);
    expect(p.left).toBe(100);
    expect(p.width).toBe(300);
  });

  it("stays below, shortened, when there's still more room below than above", () => {
    const p = choosePanelPlacement(rect(60), 400);
    expect(p).toEqual({ side: "below", maxHeight: 400 - 100 - 4 - 8 });
  });

  it("shortens an above panel to the room above", () => {
    // 200px above, 180px below.
    const p = choosePanelPlacement(rect(212), 444);
    expect(p.side).toBe("above");
    if (p.side === "above") expect(p.maxHeight).toBe(212 - 4 - 8);
  });

  it("always opens above when the caller asks for it", () => {
    expect(choosePanelPlacement(rect(100), VIEWPORT, "above").side).toBe("above");
  });
});

const OPTIONS: SelectOption[] = [
  { value: "alice@x.com", label: "Alice" },
  { value: "bob@x.com", label: "Bob" },
];

describe("DropdownShell — placement in the page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector("[data-fixed-footer]")?.remove();
    resetOpenDropdown();
  });

  function addFooter(top: number) {
    const footer = document.createElement("footer");
    footer.setAttribute("data-fixed-footer", "");
    footer.getBoundingClientRect = () =>
      ({ top, bottom: window.innerHeight, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    document.body.appendChild(footer);
  }

  it("portals the panel above a trigger that sits just over the footer", async () => {
    const footerTop = window.innerHeight - 64;
    addFooter(footerTop);
    // The trigger's wrapper is the only element measured by the shell.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = footerTop - 80;
      return { top, bottom: top + 40, left: 10, right: 310, width: 300, height: 40, x: 10, y: top, toJSON() {} } as DOMRect;
    });

    const { container } = render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Anyone/ }));

    const panel = screen.getByRole("listbox");
    // Out of the component's own tree, fixed, and above the footer's z-30.
    expect(container.contains(panel)).toBe(false);
    expect(panel.className.split(" ")).toEqual(expect.arrayContaining(["fixed", "z-100"]));
    expect(panel.style.bottom).toBe(`${window.innerHeight - (footerTop - 80) + 4}px`);
  });

  it("keeps the panel inline below the trigger when it fits", async () => {
    const { container } = render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Anyone/ }));

    const panel = screen.getByRole("listbox");
    expect(container.contains(panel)).toBe(true);
    expect(panel.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "top-full"]));
  });
});
