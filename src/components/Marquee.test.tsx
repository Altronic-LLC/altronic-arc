import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Marquee, MARQUEE_SPEED_PX_PER_S } from "./Marquee";

// jsdom has no layout: every width is 0. These tests give the box and the
// text widths of their own, the way a browser would measure them.
const realScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
const realClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const realMatchMedia = window.matchMedia;

function widths(text: number, box: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => text });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => box });
}

function reducedMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  if (realScroll) Object.defineProperty(HTMLElement.prototype, "scrollWidth", realScroll);
  if (realClient) Object.defineProperty(HTMLElement.prototype, "clientWidth", realClient);
  window.matchMedia = realMatchMedia;
});

const MESSAGE = "You don't have SharePoint access to Teradyne Log, Panel Orders and Visit Reports.";

describe("Marquee", () => {
  it("sits still, once, when the text fits", () => {
    widths(300, 400);
    const { container } = render(<Marquee text={MESSAGE} />);
    expect(container.querySelector("[data-marquee]")).toBeNull();
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it("scrolls when the text is wider than its box", () => {
    widths(500, 200);
    const { container } = render(<Marquee text={MESSAGE} />);
    expect(container.querySelector('[data-marquee="scrolling"]')).not.toBeNull();
    // Two copies for a seamless loop; a screen reader hears one.
    const copies = screen.getAllByText(MESSAGE);
    expect(copies).toHaveLength(2);
    expect(copies[1].closest("[aria-hidden]")).not.toBeNull();
    expect(copies[0].closest("[aria-hidden]")).toBeNull();
  });

  it("keeps a constant speed, so a long message doesn't race", () => {
    widths(1000, 200);
    const { container } = render(<Marquee text={MESSAGE} />);
    const track = container.querySelector(".animate-marquee") as HTMLElement;
    const seconds = parseFloat(track.style.animationDuration);
    // The text plus its 48px gap, at the set speed.
    expect(seconds).toBeCloseTo((1000 + 48) / MARQUEE_SPEED_PX_PER_S, 5);
  });

  it("pauses on hover and keyboard focus of the button it sits in", () => {
    widths(500, 200);
    const { container } = render(<Marquee text={MESSAGE} />);
    const track = container.querySelector(".animate-marquee") as HTMLElement;
    expect(track.className).toContain("group-hover:[animation-play-state:paused]");
    expect(track.className).toContain("group-focus-visible:[animation-play-state:paused]");
  });

  it("doesn't scroll for someone who asked for reduced motion — it truncates", () => {
    reducedMotion(true);
    widths(500, 200);
    const { container } = render(<Marquee text={MESSAGE} />);
    expect(container.querySelector("[data-marquee]")).toBeNull();
    const only = screen.getByText(MESSAGE);
    expect(only.className).toContain("truncate");
  });
});
