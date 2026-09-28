import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { PartsBookView } from "./PartsBookView";

/** Shows where the router ended up, so a navigation can be asserted. */
function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderBook(route = "/engineering/parts") {
  return renderWithProviders(
    <Routes>
      <Route path="/engineering/parts" element={<PartsBookView />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { route },
  );
}

describe("PartsBookView", () => {
  it("shows all nine Parts Books straight away, before the lists load", () => {
    renderBook();
    for (const book of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(screen.getByText(`${book}00`)).toBeInTheDocument();
    }
  });

  it("fills in the counts once both lists have loaded", async () => {
    renderBook();
    // Book 6 holds 601/610/611/615/602/604/632/672/691 in the mock data.
    await waitFor(() => expect(screen.getAllByText(/\d+ parts$/).length).toBeGreaterThan(0));
  });

  it("disables a book with no parts in it", async () => {
    renderBook();
    // No mock part starts with 4.
    await waitFor(() => expect(screen.getByRole("button", { name: /400/ })).toBeDisabled());
  });

  it("opens a book to show its three-digit lists, HOC ones labelled", async () => {
    renderBook("/engineering/parts?book=6");
    expect(await screen.findByRole("link", { name: /^601/ })).toHaveAttribute(
      "href",
      "/engineering/parts/list/601",
    );
    expect(screen.getByRole("link", { name: /^610/ })).toBeInTheDocument();
    // 601 is a Component List (Through Hole) list; 610 is not.
    expect(screen.getByRole("link", { name: /^601/ })).toHaveTextContent("Through Hole");
    expect(screen.getByRole("link", { name: /^610/ })).not.toHaveTextContent("Through Hole");
  });

  it("jumps to a list for a three-digit number", async () => {
    renderBook();
    await userEvent.type(screen.getByLabelText("Parts list or part number"), "504{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/engineering/parts/list/504");
  });

  it("jumps straight to a part for a whole part number, on either list", async () => {
    renderBook();
    await waitFor(() => expect(screen.getAllByText(/\d+ parts$/).length).toBeGreaterThan(0));
    await userEvent.type(screen.getByLabelText("Parts list or part number"), "601110{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/engineering/parts/component/1");
  });

  it("searches for a part number it can't find, rather than dead-ending", async () => {
    renderBook();
    await waitFor(() => expect(screen.getAllByText(/\d+ parts$/).length).toBeGreaterThan(0));
    await userEvent.type(screen.getByLabelText("Parts list or part number"), "601999{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/engineering/parts/search?f.partNumber=601999");
  });

  it("runs a Global Search for words", async () => {
    renderBook();
    await userEvent.type(screen.getByLabelText("Parts list or part number"), "usb modbus{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/engineering/parts/search?q=usb%20modbus");
  });

  it("tells an approver what's waiting for them, linking to that search", async () => {
    // Mock mode: the demo user holds every role. Mock data has one component
    // at engineering review (701990) and two things at SAP (604612, 711702).
    renderBook();
    const banner = await screen.findByRole("link", { name: /Waiting for you/ });
    expect(banner).toHaveTextContent("1 waiting for engineering review and 2 waiting to be added to SAP");
    expect(banner).toHaveAttribute("href", "/engineering/parts/search?f.signOffStatus=Pending");
  });

  it("links to Global Search", () => {
    renderBook();
    expect(screen.getByRole("link", { name: /Global Search/ })).toHaveAttribute("href", "/engineering/parts/search");
  });
});
