import { describe, expect, it } from "vitest";
// Vite's ?raw import — same approach as commentFileUpload.wiring.test.ts.
import BUILD_REQUEST from "./BuildRequestDetailView.tsx?raw";
import COST_IMPACT from "./CostImpactNoticeDetailView.tsx?raw";
import CUSTOMER_NOTE from "./CustomerNoteDetailView.tsx?raw";
import CUSTOMER_QUOTE from "./CustomerQuoteDetailView.tsx?raw";
import DETAIL from "./DetailView.tsx?raw";
import ECN from "./EcnDetailView.tsx?raw";
import EIR from "./EirDetailView.tsx?raw";
import FAIT from "./FaitDetailView.tsx?raw";
import FEATURE_REQUEST from "./FeatureRequestDetailView.tsx?raw";
import GRAY_MARKET from "./GrayMarketRequestDetailView.tsx?raw";
import MAINTENANCE from "./MaintenanceDetailView.tsx?raw";
import MCN from "./McnDetailView.tsx?raw";
import MRB from "./MrbDetailView.tsx?raw";
import NEW_PRODUCT from "./NewProductPricingDetailView.tsx?raw";
import OPERATIONS from "./OperationsDetailView.tsx?raw";
import PANEL_ORDER from "./PanelOrderDetailView.tsx?raw";
import PANEL_TASK from "./PanelTaskDetailView.tsx?raw";
import PRICING_REQUEST from "./PricingRequestDetailView.tsx?raw";
import QUOTE from "./QuoteDetailView.tsx?raw";
import SCN from "./ScnDetailView.tsx?raw";
import SUPPLIER from "./SupplierDetailView.tsx?raw";
import BR_ITEM from "../components/BuildRequestItemCard.tsx?raw";
import PANEL_QC from "../components/PanelQcIssueFormModal.tsx?raw";
import SUPPLIER_CONTACT from "../components/SupplierContactCard.tsx?raw";
import SUPPLIER_ISSUE from "../components/SupplierIssueCard.tsx?raw";

// =============================================================================
// Every comment box is told who its comment will email (BusinessIT#4).
//
// The out-of-office line above a comment box checks the people @-mentioned AND
// the record's watchers and assignees — but the box only knows the second
// group if the page passes `notifies`. A page that forgets checks mentions
// only, and nobody notices: the line simply never shows for a watcher. So this
// reads every file that renders a comment box and requires the prop on both
// the box and the thread (whose reply box passes it on).
// =============================================================================

/** Threads that email only the people mentioned — nobody else to check. */
const MENTIONS_ONLY = new Set(["CustomerNoteDetailView.tsx"]);

const FILES: { name: string; source: string }[] = [
  { name: "BuildRequestDetailView.tsx", source: BUILD_REQUEST },
  { name: "CostImpactNoticeDetailView.tsx", source: COST_IMPACT },
  { name: "CustomerNoteDetailView.tsx", source: CUSTOMER_NOTE },
  { name: "CustomerQuoteDetailView.tsx", source: CUSTOMER_QUOTE },
  { name: "DetailView.tsx", source: DETAIL },
  { name: "EcnDetailView.tsx", source: ECN },
  { name: "EirDetailView.tsx", source: EIR },
  { name: "FaitDetailView.tsx", source: FAIT },
  { name: "FeatureRequestDetailView.tsx", source: FEATURE_REQUEST },
  { name: "GrayMarketRequestDetailView.tsx", source: GRAY_MARKET },
  { name: "MaintenanceDetailView.tsx", source: MAINTENANCE },
  { name: "McnDetailView.tsx", source: MCN },
  { name: "MrbDetailView.tsx", source: MRB },
  { name: "NewProductPricingDetailView.tsx", source: NEW_PRODUCT },
  { name: "OperationsDetailView.tsx", source: OPERATIONS },
  { name: "PanelOrderDetailView.tsx", source: PANEL_ORDER },
  { name: "PanelTaskDetailView.tsx", source: PANEL_TASK },
  { name: "PricingRequestDetailView.tsx", source: PRICING_REQUEST },
  { name: "QuoteDetailView.tsx", source: QUOTE },
  { name: "ScnDetailView.tsx", source: SCN },
  { name: "SupplierDetailView.tsx", source: SUPPLIER },
  { name: "BuildRequestItemCard.tsx", source: BR_ITEM },
  { name: "PanelQcIssueFormModal.tsx", source: PANEL_QC },
  { name: "SupplierContactCard.tsx", source: SUPPLIER_CONTACT },
  { name: "SupplierIssueCard.tsx", source: SUPPLIER_ISSUE },
];

describe("comment out-of-office wiring", () => {
  it("every listed source loaded and renders a comment box", () => {
    for (const { name, source } of FILES) {
      expect(source.includes("<CommentComposer"), `${name} has no CommentComposer`).toBe(true);
    }
  });

  it("every comment box AND thread is told who the comment emails", () => {
    const offenders = FILES.filter(({ name, source }) => {
      if (MENTIONS_ONLY.has(name)) return false;
      return !/<CommentComposer[^>]*\bnotifies=/.test(source) || !/<CommentThread[^>]*\bnotifies=/.test(source);
    }).map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("the mentions-only threads really pass nobody", () => {
    for (const name of MENTIONS_ONLY) {
      const file = FILES.find((f) => f.name === name)!;
      expect(file.source.includes("notifies="), `${name} passes notifies — drop it from MENTIONS_ONLY`).toBe(false);
    }
  });
});
