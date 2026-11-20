import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MovedTo } from "./MovedTo";

function Where() {
  const { pathname, search } = useLocation();
  return <p>{`${pathname}${search}`}</p>;
}

describe("MovedTo", () => {
  it("redirects an old Harness Production Log link to the Harness department, filters kept", () => {
    render(
      <MemoryRouter initialEntries={["/operations/harness-log?year=2024&part=12"]}>
        <Routes>
          <Route path="/operations/harness-log" element={<MovedTo to="/harness/production-log" />} />
          <Route path="/harness/production-log" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("/harness/production-log?year=2024&part=12")).toBeInTheDocument();
  });
});
