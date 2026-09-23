import { describe, expect, it } from "vitest";
import {
  buildFeatureRequestStatusEmails,
  buildNewFeatureRequestEmails,
} from "./featureRequestAlerts";
import type { ChangeTarget } from "./changeAlerts";
import type { Person } from "@/types/task";

const TARGET: ChangeTarget = { kind: "featureRequest", id: 7, title: "Dark mode for print views" };

const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const JERROD: Person = { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" };

describe("a new feature request", () => {
  it("emails the intake list", () => {
    const emails = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: JERROD,
    });

    expect(emails).toHaveLength(1);
    expect(emails[0].email).toBe(RAY.email);
    expect(emails[0].subject).toContain("New ARC feature request");
    expect(emails[0].subject).toContain(TARGET.title);
    expect(emails[0].headlineHtml).toContain("Jerrod Waldron");
  });

  it("carries the fields that were filled in", () => {
    const [email] = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: JERROD,
      details: [
        { label: "Department", value: "Engineering" },
        { label: "Priority", value: "Low" },
      ],
    });

    expect(email.detailHtml).toContain("Department");
    expect(email.detailHtml).toContain("Engineering");
    expect(email.detailHtml).toContain("Priority");
  });

  it("DROPS a blank detail rather than rendering a dash", () => {
    // A request is mostly optional fields; a grid of dashes reads as a fault.
    const [email] = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: JERROD,
      details: [
        { label: "Department", value: "Engineering" },
        { label: "Priority", value: "" },
        { label: "Description", value: "   " },
      ],
    });

    expect(email.detailHtml).toContain("Department");
    expect(email.detailHtml).not.toContain("Priority");
    expect(email.detailHtml).not.toContain("Description");
  });

  it("leaves the ACTOR off their own request", () => {
    const emails = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY, JERROD],
      actor: JERROD,
    });

    expect(emails.map((e) => e.email)).toEqual([RAY.email]);
  });

  it("STILL emails the actor when they are the only recipient", () => {
    // A queue going silent because the only recipient raised it is worse than
    // one redundant email — `withoutActorUnlessEmpty`, as everywhere else.
    const emails = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: RAY,
    });

    expect(emails.map((e) => e.email)).toEqual([RAY.email]);
  });

  it("sends nothing when nothing is configured", () => {
    expect(
      buildNewFeatureRequestEmails({ target: TARGET, recipients: [], actor: JERROD }),
    ).toEqual([]);
  });

  it("escapes a name that contains markup", () => {
    const [email] = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: { displayName: "<script>x</script>", email: "x@y.com" },
    });

    expect(email.headlineHtml).not.toContain("<script>");
  });

  it("falls back to 'Someone' for a nameless actor", () => {
    const [email] = buildNewFeatureRequestEmails({
      target: TARGET,
      recipients: [RAY],
      actor: { displayName: "", email: "x@y.com" },
    });

    expect(email.headlineHtml).toContain("Someone");
  });
});

describe("a status change", () => {
  it("names both ends of the move", () => {
    const [email] = buildFeatureRequestStatusEmails({
      target: TARGET,
      recipients: [RAY],
      actor: JERROD,
      from: "Pending Review",
      to: "In Work",
    });

    expect(email.headlineHtml).toContain("Pending Review");
    expect(email.headlineHtml).toContain("In Work");
    expect(email.subject).toContain("In Work");
  });

  it("reads sensibly when there was no previous status", () => {
    const [email] = buildFeatureRequestStatusEmails({
      target: TARGET,
      recipients: [RAY],
      actor: JERROD,
      from: "",
      to: "Completed",
    });

    expect(email.headlineHtml).toContain("no status");
    expect(email.headlineHtml).toContain("Completed");
  });

  it("leaves the actor off unless they are the only recipient", () => {
    expect(
      buildFeatureRequestStatusEmails({
        target: TARGET,
        recipients: [RAY, JERROD],
        actor: JERROD,
        from: "Pending Review",
        to: "In Work",
      }).map((e) => e.email),
    ).toEqual([RAY.email]);

    expect(
      buildFeatureRequestStatusEmails({
        target: TARGET,
        recipients: [RAY],
        actor: RAY,
        from: "Pending Review",
        to: "In Work",
      }).map((e) => e.email),
    ).toEqual([RAY.email]);
  });

  it("sends nothing when nothing is configured", () => {
    expect(
      buildFeatureRequestStatusEmails({
        target: TARGET,
        recipients: [],
        actor: JERROD,
        from: "Pending Review",
        to: "In Work",
      }),
    ).toEqual([]);
  });
});
