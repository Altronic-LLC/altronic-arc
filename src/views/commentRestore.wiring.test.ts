import { describe, expect, it } from "vitest";
// Vite's ?raw import rather than node:fs — the app's tsconfig has no Node
// types. Same approach as commentFileUpload.wiring.test.ts.
import BUILD_REQUEST from "./BuildRequestDetailView.tsx?raw";
import COST_IMPACT from "./CostImpactNoticeDetailView.tsx?raw";
import CUSTOMER_NOTE from "./CustomerNoteDetailView.tsx?raw";
import TASK from "./DetailView.tsx?raw";
import ECN from "./EcnDetailView.tsx?raw";
import EIR from "./EirDetailView.tsx?raw";
import FAIT from "./FaitDetailView.tsx?raw";
import FEATURE_REQUEST from "./FeatureRequestDetailView.tsx?raw";
import GRAY_MARKET from "./GrayMarketRequestDetailView.tsx?raw";
import MAINTENANCE from "./MaintenanceDetailView.tsx?raw";
import MRB from "./MrbDetailView.tsx?raw";
import OPERATIONS from "./OperationsDetailView.tsx?raw";
import PANEL_ORDER from "./PanelOrderDetailView.tsx?raw";
import PANEL_TASK from "./PanelTaskDetailView.tsx?raw";
import QUOTE from "./QuoteDetailView.tsx?raw";
import SCN from "./ScnDetailView.tsx?raw";
import SUPPLIER from "./SupplierDetailView.tsx?raw";
import BUILD_REQUEST_ITEM from "@/components/BuildRequestItemCard.tsx?raw";
import PANEL_QC_ISSUE from "@/components/PanelQcIssueFormModal.tsx?raw";
import SUPPLIER_CONTACT from "@/components/SupplierContactCard.tsx?raw";
import SUPPLIER_ISSUE from "@/components/SupplierIssueCard.tsx?raw";

// =============================================================================
// Every comment composer's onSubmit RETURNS the save's promise.
//
// The composer clears as soon as Send is pressed. It can only put a comment
// back when the post fails if the caller hands it the promise — a
// fire-and-forget `addComment.mutate(...)` resolves at once, and the failure
// never reaches the composer. Before this, a failed comment was simply gone:
// Thomas Terhune re-pasted his (2026-09-30), and every @-mention in it became
// plain text that notified and subscribed nobody.
//
// Structural, like commentFileUpload.wiring.test.ts: nothing about a missing
// `return` is visible to a type check, since `onSubmit` may return void.
// =============================================================================

/**
 * Every file rendering a comment composer. Listed explicitly — `?raw` needs a
 * literal path, and a new one missing from here is itself worth noticing.
 */
const SOURCES: { name: string; source: string }[] = [
  { name: "BuildRequestDetailView.tsx", source: BUILD_REQUEST },
  { name: "CostImpactNoticeDetailView.tsx", source: COST_IMPACT },
  { name: "CustomerNoteDetailView.tsx", source: CUSTOMER_NOTE },
  { name: "DetailView.tsx", source: TASK },
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
  { name: "QuoteDetailView.tsx", source: QUOTE },
  { name: "ScnDetailView.tsx", source: SCN },
  { name: "SupplierDetailView.tsx", source: SUPPLIER },
  { name: "BuildRequestItemCard.tsx", source: BUILD_REQUEST_ITEM },
  { name: "PanelQcIssueFormModal.tsx", source: PANEL_QC_ISSUE },
  { name: "SupplierContactCard.tsx", source: SUPPLIER_CONTACT },
  { name: "SupplierIssueCard.tsx", source: SUPPLIER_ISSUE },
];

/** The body of `handleAddComment`, up to its closing brace at two spaces. */
function handler(source: string): string | null {
  return source.match(/function handleAddComment[\s\S]*?\n {2}\}\r?\n/)?.[0] ?? null;
}

describe("comment restore wiring", () => {
  it("every listed source renders a composer wired to handleAddComment", () => {
    for (const { name, source } of SOURCES) {
      expect(source, `${name} has no comment composer`).toContain("<CommentComposer");
      expect(source, `${name} has no onSubmit={handleAddComment}`).toContain(
        "onSubmit={handleAddComment}",
      );
      expect(handler(source), `${name}: handleAddComment not found`).not.toBeNull();
    }
  });

  it("every handleAddComment returns the save's promise rather than firing and forgetting", () => {
    const offenders = SOURCES.filter(({ source }) => {
      const body = handler(source) ?? "";
      return !/return [\s\S]*mutateAsync\(/.test(body) || /\.mutate\(/.test(body);
    }).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it("every comment thread offers Reply through that same handler", () => {
    // Threaded replies (BusinessIT#9) post through the page's own
    // handleAddComment, so notifications, mirrors and restore-on-failure all
    // come with them. A thread without onReply silently has no Reply button.
    const offenders = SOURCES.filter(({ source }) => {
      const start = source.indexOf("<CommentThread");
      const block = start < 0 ? "" : source.slice(start, source.indexOf("/>", start));
      return !block.includes("onReply={handleAddComment}");
    }).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});
