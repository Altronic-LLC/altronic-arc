import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  joinNames,
  stepNumbers,
  WorkflowDiagram,
  type WorkflowTrack,
} from "./WorkflowDiagram";

const status = (s: string) => <span data-testid="status">{s}</span>;

const ONE: WorkflowTrack = {
  items: [
    { kind: "step", who: "Alice", title: "Start", status: "Open", detail: "Begin.", emails: "Bob" },
    { kind: "gate", label: "the form is complete" },
    {
      kind: "step",
      who: "Bob",
      title: "Review",
      status: "Reviewed",
      detail: "Look it over.",
      branches: [
        { when: "If it's wrong:", detail: "Send it back.", status: "Rejected", emails: "Alice", goesTo: "Start" },
        { when: "If it names nothing real:", detail: "No link drawn.", goesTo: "Nowhere" },
      ],
    },
    { kind: "gate", prefix: "Only when:", label: "a manager is needed" },
    { kind: "step", who: "Carol", title: "Finish", detail: "Done." },
  ],
};

describe("joinNames", () => {
  it("joins with commas and a final conjunction", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"], "or")).toBe("A, B or C");
    expect(joinNames(["A", "", "B"])).toBe("A and B");
  });
});

describe("stepNumbers", () => {
  it("numbers steps only, skipping gates", () => {
    expect([...stepNumbers(ONE.items)]).toEqual([
      ["Start", 1],
      ["Review", 2],
      ["Finish", 3],
    ]);
  });
});

describe("WorkflowDiagram", () => {
  it("names the step list after the title and numbers each step", () => {
    render(<WorkflowDiagram title="Demo workflow" tracks={[ONE]} renderStatus={status} />);
    const list = screen.getByRole("list", { name: "Demo workflow" });
    for (const n of ["1", "2", "3"]) expect(within(list).getByText(n)).toBeInTheDocument();
    expect(within(list).getByText("Carol")).toBeInTheDocument();
  });

  it("renders each status through the department's own badge", () => {
    render(<WorkflowDiagram title="Demo" tracks={[ONE]} renderStatus={status} />);
    expect(screen.getAllByTestId("status").map((e) => e.textContent)).toEqual([
      "Open",
      "Reviewed",
      "Rejected",
    ]);
  });

  it("labels each gate, with its own prefix when given", () => {
    render(<WorkflowDiagram title="Demo" tracks={[ONE]} renderStatus={status} />);
    expect(screen.getByText("Unlocks when:")).toBeInTheDocument();
    expect(screen.getByText("Only when:")).toBeInTheDocument();
  });

  it("draws a branch, and points it at the step it leads to by number", () => {
    render(<WorkflowDiagram title="Demo" tracks={[ONE]} renderStatus={status} />);
    expect(screen.getByText("If it's wrong:")).toBeInTheDocument();
    expect(screen.getByText("Goes to step 1: Start")).toBeInTheDocument();
    // A branch naming a step that isn't there draws no link rather than a wrong one.
    expect(screen.queryByText(/Nowhere/)).not.toBeInTheDocument();
  });

  it("labels each track and numbers it from 1 when there are several", () => {
    const second: WorkflowTrack = {
      label: "Short path",
      items: [{ kind: "step", who: "Dan", title: "Only step", detail: "Just this." }],
    };
    render(
      <WorkflowDiagram title="Demo" tracks={[{ ...ONE, label: "Long path" }, second]} renderStatus={status} />,
    );
    const short = screen.getByRole("list", { name: "Demo: Short path" });
    expect(within(short).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Demo: Long path" })).toBeInTheDocument();
    expect(screen.getByText("Short path")).toBeInTheDocument();
  });

  it("renders the extra sections under the steps", () => {
    render(
      <WorkflowDiagram
        title="Demo"
        tracks={[ONE]}
        renderStatus={status}
        sections={[{ heading: "Off the main path", body: <p>Side statuses</p> }]}
      />,
    );
    expect(screen.getByText("Off the main path")).toBeInTheDocument();
    expect(screen.getByText("Side statuses")).toBeInTheDocument();
  });
});
