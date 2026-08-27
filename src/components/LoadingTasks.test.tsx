import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LoadingTasks } from "./LoadingTasks";
import { LOADING_FACTS } from "@/data/loadingFacts";

describe("LoadingTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the noun in the headline", () => {
    render(<LoadingTasks noun="cost impact notices" />);
    expect(screen.getByText(/cost impact notices/)).toBeInTheDocument();
  });

  it("defaults the noun to 'tasks'", () => {
    render(<LoadingTasks />);
    expect(screen.getByText(/tasks/)).toBeInTheDocument();
  });

  it("shows one of the rotating facts", () => {
    render(<LoadingTasks />);
    const shown = LOADING_FACTS.some((f) => screen.queryByText(f) !== null);
    expect(shown).toBe(true);
  });

  it("still tells the user the first load is the slow one", () => {
    render(<LoadingTasks />);
    expect(screen.getByText(/cold starts take a moment/i)).toBeInTheDocument();
  });

  it("advances to a different fact over time", () => {
    render(<LoadingTasks />);
    const first = LOADING_FACTS.find((f) => screen.queryByText(f) !== null)!;

    act(() => {
      vi.advanceTimersByTime(4500);
    });
    const second = LOADING_FACTS.find((f) => screen.queryByText(f) !== null)!;

    // Sequential rotation over `LOADING_FACTS.length` distinct facts —
    // one tick always lands on a different entry.
    expect(second).not.toBe(first);
  });
});
