import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { BuildRequestSourceLinks, buildRequestSourceLinks } from "./BuildRequestSourceLinks";
import type { BuildRequest } from "@/types/task";

// The records a build request was raised from (BusinessIT#68/#69/#65), shown
// on the request's page. Mock EIR 3 is EIR_2026-0044.

const br = (o: Partial<BuildRequest>) => ({ id: 1, ...o }) as BuildRequest;
const none = { eir: () => null, grayMarket: () => null, fait: () => null };

describe("BuildRequestSourceLinks", () => {
  it("names an EIR by its number, from the EIR list", async () => {
    renderWithProviders(<BuildRequestSourceLinks br={br({ eirReferenceLookupId: 3 })} />);
    const link = await screen.findByRole("link", { name: "EIR_2026-0044" });
    expect(link).toHaveAttribute("href", "/eir/3");
  });

  it("falls back to the kind and id when the record isn't loaded", () => {
    expect(buildRequestSourceLinks(br({ grayMarketRequestId: 12, faitReferenceLookupId: 4 }), none)).toEqual([
      { kind: "grayMarket", id: 12, label: "Gray Market request #12" },
      { kind: "fait", id: 4, label: "FAIT #4" },
    ]);
  });

  it("renders nothing for a request raised from none of them", () => {
    const { container } = renderWithProviders(<BuildRequestSourceLinks br={br({})} />);
    expect(container).toBeEmptyDOMElement();
  });
});
