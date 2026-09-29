import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  buildBrCompleteEmails,
  buildBrPartProductionCompleteEmails,
  buildBrProductionCompleteReviewEmails,
  buildBrReadyForProductionEmails,
} from "./buildRequestAlerts";

const AMANDA: Person = { displayName: "Amanda Hoagland", email: "Amanda.Hoagland@altronic-llc.com" };
const SHEILA: Person = { displayName: "Sheila Horn", email: "Sheila.Horn@altronic-llc.com" };
const ENGINEER: Person = { displayName: "Femi Olugbon", email: "femi.olugbon@altronic-llc.com" };
const REQUESTOR: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const WATCHER: Person = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const PART_WATCHER: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const BR = { kind: "buildRequest" as const, id: 9, title: "BR_2026-0070" };
const PART = { kind: "buildRequestItem" as const, id: 41, title: "791950-16" };

const to = (emails: { email: string }[]) => emails.map((e) => e.email.toLowerCase());

describe("a. ready for production", () => {
  const build = (over: Partial<Parameters<typeof buildBrReadyForProductionEmails>[0]> = {}) =>
    buildBrReadyForProductionEmails({
      target: BR,
      queue: [AMANDA, SHEILA],
      actor: RAY,
      engineer: ENGINEER,
      requestor: REQUESTOR,
      watchers: [WATCHER],
      ...over,
    });

  it("reaches the queue, the engineer, the watchers and the requestor", () => {
    expect(to(build())).toEqual(
      [AMANDA, SHEILA, ENGINEER, WATCHER, REQUESTOR].map((p) => p.email!.toLowerCase()),
    );
  });

  it("asks the queue to schedule it, and tells everyone else", () => {
    const emails = build();
    expect(emails[0].subject).toBe("Ready for production: BR_2026-0070");
    expect(emails[0].detailHtml).toContain("schedule it into production");
    expect(emails[2].detailHtml).not.toContain("schedule it into production");
    expect(emails[0].headlineHtml).toContain("Ray White");
  });

  it("sends ONE email to somebody who is on the queue AND watching (case-insensitive)", () => {
    const emails = build({ watchers: [{ ...SHEILA, email: "sheila.horn@ALTRONIC-LLC.com" }, WATCHER] });
    expect(to(emails).filter((e) => e === "sheila.horn@altronic-llc.com")).toHaveLength(1);
    // The queue copy wins, so she still gets the action wording.
    expect(emails.find((e) => e.email.toLowerCase().startsWith("sheila"))!.detailHtml).toContain(
      "schedule it",
    );
  });

  it("de-dupes the engineer who is also a watcher and the requestor", () => {
    expect(to(build({ watchers: [ENGINEER], requestor: ENGINEER }))).toEqual(
      [AMANDA, SHEILA, ENGINEER].map((p) => p.email!.toLowerCase()),
    );
  });

  it("drops the actor STRICTLY from the request's own people — the engineer pressing it", () => {
    expect(to(build({ actor: ENGINEER }))).not.toContain(ENGINEER.email!.toLowerCase());
  });

  it("drops the actor from the queue unless that would empty it", () => {
    expect(to(build({ actor: SHEILA }))).not.toContain(SHEILA.email!.toLowerCase());
    const onlyHer = build({ actor: SHEILA, queue: [SHEILA], engineer: null, watchers: [], requestor: null });
    expect(to(onlyHer)).toEqual([SHEILA.email!.toLowerCase()]);
  });

  it("skips anyone without a mailbox, and returns [] when nobody is left", () => {
    expect(to(build({ watchers: [{ displayName: "No Mailbox" }] }))).not.toContain("");
    expect(build({ queue: [], engineer: null, requestor: null, watchers: [] })).toEqual([]);
  });
});

describe("b. a part reaches Production Complete", () => {
  const build = (over: Partial<Parameters<typeof buildBrPartProductionCompleteEmails>[0]> = {}) =>
    buildBrPartProductionCompleteEmails({
      target: PART,
      buildRequestTitle: "BR_2026-0070",
      partWatchers: [PART_WATCHER],
      actor: RAY,
      engineer: ENGINEER,
      requestor: REQUESTOR,
      watchers: [WATCHER],
      ...over,
    });

  it("reaches the engineer, request watchers, part watchers and requestor — no queue", () => {
    expect(to(build())).toEqual(
      [ENGINEER, WATCHER, PART_WATCHER, REQUESTOR].map((p) => p.email!.toLowerCase()),
    );
    expect(to(build())).not.toContain(AMANDA.email!.toLowerCase());
  });

  it("names the part and its build request", () => {
    const e = build()[0];
    expect(e.subject).toBe("Part production complete: 791950-16 (BR_2026-0070)");
    expect(e.headlineHtml).toContain("791950-16");
    expect(e.headlineHtml).toContain("BR_2026-0070");
  });

  it("one email for someone watching both the part and the request", () => {
    expect(to(build({ partWatchers: [WATCHER] }))).toEqual(
      [ENGINEER, WATCHER, REQUESTOR].map((p) => p.email!.toLowerCase()),
    );
  });

  it("never emails the actor — not even when they are the only person involved", () => {
    expect(build({ actor: ENGINEER, engineer: ENGINEER, watchers: [], partWatchers: [], requestor: null })).toEqual([]);
  });
});

describe("c. request reaches Production Complete — the review request", () => {
  const build = (over: Partial<Parameters<typeof buildBrProductionCompleteReviewEmails>[0]> = {}) =>
    buildBrProductionCompleteReviewEmails({ target: BR, reviewers: [SHEILA], actor: RAY, ...over });

  it("goes to the reviewers only and asks them to set it Complete", () => {
    const emails = build();
    expect(to(emails)).toEqual([SHEILA.email!.toLowerCase()]);
    expect(emails[0].subject).toBe("Review production complete: BR_2026-0070");
    expect(emails[0].detailHtml).toContain("set its status to Complete");
  });

  it("keeps the reviewer when she is the actor (a queue must not go silent)", () => {
    expect(to(build({ actor: SHEILA }))).toEqual([SHEILA.email!.toLowerCase()]);
  });

  it("is empty when nobody is configured", () => {
    expect(build({ reviewers: [] })).toEqual([]);
  });
});

describe("d. request complete", () => {
  const build = (over: Partial<Parameters<typeof buildBrCompleteEmails>[0]> = {}) =>
    buildBrCompleteEmails({
      target: BR,
      queue: [AMANDA],
      actor: SHEILA,
      engineer: ENGINEER,
      requestor: REQUESTOR,
      watchers: [WATCHER],
      ...over,
    });

  it("reaches the final queue, the watchers, the engineer and the requestor", () => {
    expect(to(build())).toEqual(
      [AMANDA, WATCHER, ENGINEER, REQUESTOR].map((p) => p.email!.toLowerCase()),
    );
  });

  it("says it is complete", () => {
    const e = build()[0];
    expect(e.subject).toBe("Build request complete: BR_2026-0070");
    expect(e.headlineHtml).toContain("Complete");
    expect(e.detailHtml).toContain("no further action");
  });

  it("leaves Sheila (the actor) off her own completion even when she watches it", () => {
    expect(to(build({ watchers: [SHEILA, WATCHER] }))).not.toContain(SHEILA.email!.toLowerCase());
  });

  it("de-dupes Amanda when she is also a watcher", () => {
    expect(to(build({ watchers: [AMANDA] })).filter((e) => e.startsWith("amanda"))).toHaveLength(1);
  });

  it("escapes names in the HTML", () => {
    const html = build({ actor: { displayName: "<b>x</b>", email: "x@altronic-llc.com" } })[0].headlineHtml;
    expect(html).not.toContain("<b>x</b>");
  });
});
