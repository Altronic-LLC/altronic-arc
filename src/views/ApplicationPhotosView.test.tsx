import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetApplicationPhotosMock } from "@/api/applicationPhotos";
import { ApplicationPhotosView } from "./ApplicationPhotosView";

// Application Photos (BusinessIT#48): the shared folder screen on
// General/A-Application Photos, plus a camera button on a phone or iPad.

const ROUTE = "/sales/application-photos";
const realMatchMedia = window.matchMedia;

/** A touch screen (phone / iPad) or a desktop, as far as `(pointer: coarse)` goes. */
function pointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  __resetApplicationPhotosMock();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("ApplicationPhotosView", () => {
  it("opens on the photo folder with folders first and the root breadcrumb", async () => {
    pointer(false);
    renderWithProviders(<ApplicationPhotosView />, { route: ROUTE });
    const t = within(await screen.findByRole("table"));
    const names = t.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(names.slice(0, 3)).toEqual(["Compression", "Pipeline", "Power Generation"]);
    expect(names).toContain("Demo skid.jpg");
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(within(crumbs).getByText("Application Photos")).toHaveAttribute("aria-current", "page");
  });

  it("offers no camera button on a desktop — Upload covers it there", async () => {
    pointer(false);
    renderWithProviders(<ApplicationPhotosView />, { route: ROUTE });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Take photo/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Upload files/ })).toBeInTheDocument();
  });

  it("on a phone or iPad, Take photo opens the camera and saves the photo under the time it was taken", async () => {
    pointer(true);
    renderWithProviders(<ApplicationPhotosView />, { route: ROUTE });
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: /Take photo/ })).toBeInTheDocument();

    const camera = screen.getByTestId("application-photos-file-input-camera");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(camera).toHaveAttribute("capture", "environment");

    // An iPhone hands every shot over as "image.jpg".
    await userEvent.upload(camera, new File(["pixels"], "image.jpg", { type: "image/jpeg" }));
    await waitFor(() => {
      const names = within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector("td")?.textContent ?? "");
      expect(names.some((n) => /^Photo \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.jpg$/.test(n))).toBe(true);
      expect(names).not.toContain("image.jpg");
    });
  });

  it("creates a subfolder, renames it, then deletes it", async () => {
    pointer(false);
    renderWithProviders(<ApplicationPhotosView />, { route: ROUTE });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Marine{Enter}");
    const t = within(await screen.findByRole("table"));
    expect(await t.findByRole("button", { name: "Marine" })).toBeInTheDocument();

    await userEvent.click(t.getByRole("button", { name: "Rename Marine" }));
    const input = await screen.findByLabelText("New name");
    await userEvent.clear(input);
    await userEvent.type(input, "Marine Engines{Enter}");
    expect(
      await within(await screen.findByRole("table")).findByRole("button", { name: "Marine Engines" }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(await screen.findByRole("table")).getByRole("button", { name: "Delete Marine Engines" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(within(screen.getByRole("table")).queryByRole("button", { name: "Marine Engines" })).toBeNull(),
    );
  });
});
