import { describe, expect, it } from "vitest";
// Vite's ?raw import rather than node:fs — the app's tsconfig has no Node
// types, and this reads the same files the bundler does. Same approach as
// App.routes.test.ts, the other structural test in this repo.
import BUILD_REQUEST from "./BuildRequestDetailView.tsx?raw";
import COST_IMPACT from "./CostImpactNoticeDetailView.tsx?raw";
import CUSTOMER_NOTE from "./CustomerNoteDetailView.tsx?raw";
import ECN from "./EcnDetailView.tsx?raw";
import EIR from "./EirDetailView.tsx?raw";
import FAIT from "./FaitDetailView.tsx?raw";
import FEATURE_REQUEST from "./FeatureRequestDetailView.tsx?raw";
import GRAY_MARKET from "./GrayMarketRequestDetailView.tsx?raw";
import MAINTENANCE from "./MaintenanceDetailView.tsx?raw";
import OPERATIONS from "./OperationsDetailView.tsx?raw";
import PANEL_ORDER from "./PanelOrderDetailView.tsx?raw";
import MRB from "./MrbDetailView.tsx?raw";
import PANEL_TASK from "./PanelTaskDetailView.tsx?raw";
import SUPPLIER from "./SupplierDetailView.tsx?raw";

// =============================================================================
// Every comment composer must be given a way to UPLOAD a pasted file.
//
// `CommentComposer` holds a pasted/dropped image in memory to show a
// thumbnail, and only uploads it on submit IF the parent passed `uploadFile`.
// With no prop the comment posts as plain text and the screenshot is silently
// gone — nothing on screen says so, and a type check can't catch it, because
// the prop has to be optional: `CustomerNoteDetailView` and
// `FeatureRequestDetailView` have no list-item attachment store to upload to.
//
// FAIT was the only one of eleven views that passed it. EIRs and nine others
// did not, which is what "screenshots are not saving as attachments to EIR and
// are not saving to the comments" reported (Ray, 2026-09-16).
//
// So this is a STRUCTURAL test over the source, in the spirit of
// `App.routes.test.ts` (which does the same for lazy routes and Suspense): a
// view that renders a comment composer AND has an attachment store must wire
// the two together.
// =============================================================================

/**
 * Views that deliberately pass NO `uploadFile`, with the reason.
 *
 * Both lists have a Communication column but NO list-item attachment store in
 * `api/attachments.ts` (no `AttachmentParent` entry, and neither page renders
 * an `AttachmentsSection`), so there is nowhere for a pasted file to go.
 * Giving either one comment attachments means adding its parent config first.
 */
const NO_ATTACHMENT_STORE = new Set([
  "CustomerNoteDetailView.tsx",
  "FeatureRequestDetailView.tsx",
]);

/**
 * Every detail view that renders a comment thread.
 *
 * Listed explicitly rather than globbed: `?raw` needs a literal path, and a
 * new comment-carrying view being absent from this list is itself the thing
 * worth noticing — add it here in the same commit.
 */
const VIEWS: { name: string; source: string }[] = [
  { name: "BuildRequestDetailView.tsx", source: BUILD_REQUEST },
  { name: "CostImpactNoticeDetailView.tsx", source: COST_IMPACT },
  { name: "CustomerNoteDetailView.tsx", source: CUSTOMER_NOTE },
  { name: "EcnDetailView.tsx", source: ECN },
  { name: "EirDetailView.tsx", source: EIR },
  { name: "FaitDetailView.tsx", source: FAIT },
  { name: "FeatureRequestDetailView.tsx", source: FEATURE_REQUEST },
  { name: "GrayMarketRequestDetailView.tsx", source: GRAY_MARKET },
  { name: "MaintenanceDetailView.tsx", source: MAINTENANCE },
  { name: "MrbDetailView.tsx", source: MRB },
  { name: "OperationsDetailView.tsx", source: OPERATIONS },
  { name: "PanelOrderDetailView.tsx", source: PANEL_ORDER },
  { name: "PanelTaskDetailView.tsx", source: PANEL_TASK },
  { name: "SupplierDetailView.tsx", source: SUPPLIER },
];

describe("comment file upload wiring", () => {
  it("every listed source actually loaded", () => {
    // An empty string would make every case below pass vacuously.
    for (const { name, source } of VIEWS) {
      expect(source.length, `${name} read as empty`).toBeGreaterThan(100);
    }
  });

  it("every view with a comment composer AND an attachment store passes uploadFile", () => {
    const offenders = VIEWS.filter(({ name, source }) => {
      if (NO_ATTACHMENT_STORE.has(name)) return false;
      if (!source.includes("<CommentComposer")) return false;
      if (!source.includes("<AttachmentsSection")) return false;
      return !source.includes("uploadFile=");
    }).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it("passes it to the THREAD as well, so an edited comment can attach too", () => {
    const offenders = VIEWS.filter(({ name, source }) => {
      if (NO_ATTACHMENT_STORE.has(name)) return false;
      if (!source.includes("<CommentThread")) return false;
      if (!source.includes("<AttachmentsSection")) return false;
      // Both components take the prop; count them rather than just look for
      // one, since wiring only the composer is the easy half-fix.
      return (source.match(/uploadFile=/g) ?? []).length < 2;
    }).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it("the documented exemptions really have no attachment store", () => {
    // If somebody gives one of these an AttachmentsSection, it should drop out
    // of the exemption list rather than stay quietly exempt for ever.
    for (const name of NO_ATTACHMENT_STORE) {
      const view = VIEWS.find((v) => v.name === name);
      expect(view, `${name} is exempted but not in VIEWS`).toBeDefined();
      expect(
        view!.source.includes("<AttachmentsSection"),
        `${name} now has an attachment store — wire uploadFile and remove the exemption`,
      ).toBe(false);
    }
  });
});
