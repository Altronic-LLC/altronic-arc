import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { DetailTopBar } from "./DetailTopBar";
import { OpenItemsBar } from "./OpenItemsBar";
import { keepOpen, useOpenItems } from "@/hooks/useOpenItems";
import { MAX_OPEN_ITEMS, OPEN_ITEMS_FULL_MESSAGE } from "@/lib/openItems";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast: toast }));

beforeEach(() => toast.mockReset());

function Page({ label }: { label?: string }) {
  return (
    <>
      <OpenItemsBar />
      <DetailTopBar category="EIRs" listTo="/eirs" keepOpenLabel={label} />
    </>
  );
}

function strip() {
  return screen.getByRole("navigation", { name: "Kept open" });
}

describe("DetailTopBar", () => {
  it("shows the section category as a link to that section's list", () => {
    renderWithProviders(<DetailTopBar category="Panel Tasks" listTo="/panels/tasks" />);
    const link = screen.getByRole("link", { name: /panel tasks/i });
    expect(link).toHaveAttribute("href", "/panels/tasks");
  });

  it("renders a Back control", () => {
    renderWithProviders(<DetailTopBar category="EIRs" listTo="/eirs" />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("offers no Keep open without a label (settings screens, or a record still loading)", () => {
    renderWithProviders(<Page />, { route: "/eir/7" });
    expect(screen.queryByRole("button", { name: /keep open/i })).not.toBeInTheDocument();
  });

  it("Keep open adds the record to the strip, and pressing it again removes it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Page label="EIR_2026-0007 — CM4 BOM" />, { route: "/eir/7" });
    expect(screen.queryByRole("navigation", { name: "Kept open" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep open" }));
    const tab = within(strip()).getByRole("link", { name: "EIR_2026-0007 — CM4 BOM" });
    expect(tab).toHaveAttribute("href", "/eir/7");
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Kept open" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Kept open" }));
    expect(screen.queryByRole("navigation", { name: "Kept open" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep open" })).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses when full, says why, and keeps every tab already open", async () => {
    const user = userEvent.setup();
    act(() => {
      for (let n = 1; n <= MAX_OPEN_ITEMS; n++) keepOpen({ path: `/task/${n}`, label: `Task ${n}`, category: "Tasks" });
    });
    renderWithProviders(<Page label="EIR_2026-0007" />, { route: "/eir/7" });
    const button = screen.getByRole("button", { name: "Keep open" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", OPEN_ITEMS_FULL_MESSAGE);

    await user.click(button);
    expect(toast).toHaveBeenCalledWith({ message: OPEN_ITEMS_FULL_MESSAGE });
    expect(within(strip()).getAllByRole("link")).toHaveLength(MAX_OPEN_ITEMS);
    expect(within(strip()).queryByRole("link", { name: "EIR_2026-0007" })).not.toBeInTheDocument();
  });

  it("keeps a kept record's tab in step with its title", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<Page label="T3 — Old name" />, { route: "/eir/7" });
    await user.click(screen.getByRole("button", { name: "Keep open" }));
    rerender(<Page label="T3 — New name" />);
    expect(within(strip()).getByRole("link", { name: "T3 — New name" })).toBeInTheDocument();
  });

  it("never adds a tab just by visiting", () => {
    let seen: unknown;
    function Probe() {
      seen = useOpenItems();
      return null;
    }
    renderWithProviders(
      <>
        <Page label="EIR_2026-0007" />
        <Probe />
      </>,
      { route: "/eir/7" },
    );
    expect(seen).toEqual([]);
  });
});
