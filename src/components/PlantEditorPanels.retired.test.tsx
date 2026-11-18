import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_LAYOUT_COMPONENTS } from "@/data/plantMockData";
import type { PlantLayoutItem } from "@/types/plant";
import { PlantInspector } from "./PlantEditorPanels";

const mill = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "cnc-vmc-120x96")!;
const item: PlantLayoutItem = {
  uid: "i_1", componentId: mill.id, componentVersion: 1, x: 100, y: 100, w: 120, d: 96, rot: 0, label: "VMC-1", equipmentId: null, locked: false,
};
const noop = vi.fn();

describe("PlantInspector", () => {
  it("says when the selected item's symbol has been retired", () => {
    renderWithProviders(
      <PlantInspector item={item} component={mill} equipment={[]} symbolRetired onPatch={noop} onDuplicate={noop} onDelete={noop} />,
    );
    expect(screen.getByTestId("symbol-retired")).toHaveTextContent("no longer in the palette");
  });

  it("says nothing about a symbol that is still in use", () => {
    renderWithProviders(<PlantInspector item={item} component={mill} equipment={[]} onPatch={noop} onDuplicate={noop} onDelete={noop} />);
    expect(screen.queryByTestId("symbol-retired")).toBeNull();
  });
});
