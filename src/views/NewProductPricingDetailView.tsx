import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Ban, Download, Loader2, Plus, Save, X } from "lucide-react";
import { NEW_PRODUCT_PRICING_CONFIGURED } from "@/api/config";
import { draftFrom, type SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import type { DiscountSource, NewProductWorksheet, PriceBreakTier, PriceInput, SubAssembly } from "@/types/pricing";
import {
  collectWorksheetPeople,
  useAddWorksheetComment,
  useEditWorksheetComment,
  useNewProductWorksheets,
  useSetWorksheetWatchers,
  useNewProductWorksheet,
  useSaveNewProductWorksheet,
  useSubAssemblies,
  useUpdateNewProductWorksheet,
} from "@/hooks/useNewProductPricing";
import { useMpgDistributorDiscount, useSapPart } from "@/hooks/usePricingLookup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import type { Comment, Person } from "@/types/task";
import { mergePeople, personKey } from "@/lib/people";
import { downloadBlob } from "@/hooks/useQuotePdf";
import {
  MAX_PRICE_BREAKS,
  STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
  baseGrossMarginPct,
  priceBreaks,
  priceBreaksProblem,
  priceFromInput,
  tierRanges,
  worksheetCost,
} from "@/lib/pricingMath";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { buildWorksheetWorkbook, worksheetFileName } from "@/lib/worksheetExcel";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { PartCard, SubAssemblyCard, draftAsSubAssembly } from "@/components/SubAssemblyCard";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { PersonMultiField } from "@/components/PersonMultiField";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { ActionButton, PricingCard, PricingManagerGate, PricingPage, ReadField } from "@/components/pricingAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// One New Product Pricing worksheet (/sales/pricing/new-product/:id).
// Managers and admins only.
//
// THE PAGE EDITS A DRAFT. Sub-assemblies (CSV uploads, adjustments) and the
// pricing inputs change nothing until a save:
//   * Save                 — overwrites the CURRENT revision.
//   * Save as new revision — writes the draft as R+1 with a note; the current
//                            revision's rows and snapshot are left exactly as
//                            they were (Ray, 2026-10-13).
// Leaving with unsaved changes asks first. An earlier revision can be opened
// read-only from the history.
// =============================================================================

let draftSeq = 0;
const newKey = () => `new-${++draftSeq}`;

function toNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function NewProductPricingDetailView() {
  return (
    <PricingManagerGate
      configured={NEW_PRODUCT_PRICING_CONFIGURED}
      listName="NP Sub-Assemblies"
      envVar="VITE_SP_NP_SUBASSEMBLIES_LIST_ID"
    >
      {() => <WorksheetPage />}
    </PricingManagerGate>
  );
}

function WorksheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const wsId = id ? parseInt(id, 10) : null;
  const { data: ws, isLoading, error, refetch } = useNewProductWorksheet(wsId);
  const subs = useSubAssemblies(wsId);

  if (isLoading || (ws && subs.isLoading)) {
    return (
      <PricingPage>
        <LoadingTasks noun="the worksheet" />
      </PricingPage>
    );
  }
  if (error && !ws) {
    return (
      <PricingPage>
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="New Product Pricing" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
        ) : (
          <p className="py-10 text-center text-sm text-fg-muted">Couldn't load the worksheet.</p>
        )}
      </PricingPage>
    );
  }
  if (!ws) {
    return (
      <PricingPage>
        <div className="py-10 text-center">
          <p className="text-sm text-fg-muted">That worksheet doesn't exist.</p>
          <button onClick={() => navigate("/sales/pricing/new-products")} className="mt-3 text-sm text-accent hover:underline">
            Back to new products
          </button>
        </div>
      </PricingPage>
    );
  }
  if (subs.error) {
    return (
      <PricingPage>
        <p className="py-10 text-center text-sm text-fg-muted">
          Couldn't load the sub-assemblies: {subs.error instanceof Error ? subs.error.message : "unknown error"}
        </p>
      </PricingPage>
    );
  }
  // Re-keyed on the revision, so saving a new revision starts a fresh draft.
  return <Worksheet key={`${ws.id}-${ws.rev}`} ws={ws} rows={subs.data ?? []} />;
}

function Worksheet({ ws, rows }: { ws: NewProductWorksheet; rows: SubAssembly[] }) {
  const me = useCurrentUser();
  const save = useSaveNewProductWorksheet();
  const update = useUpdateNewProductWorksheet();
  const cancelled = ws.status === "Cancelled";

  const [viewRev, setViewRev] = useState(ws.rev);
  const viewingCurrent = viewRev === ws.rev;
  const readOnly = cancelled || !viewingCurrent;

  // ---- the draft ------------------------------------------------------------
  const [drafts, setDrafts] = useState<SubAssemblyDraft[]>(() =>
    rows.filter((r) => r.rev === ws.rev).sort((a, b) => a.sortOrder - b.sortOrder).map(draftFrom),
  );
  const [mpg, setMpg] = useState(ws.mpg);
  const [discount, setDiscount] = useState(String(ws.distributorDiscountPct));
  const [discountSource, setDiscountSource] = useState<DiscountSource>(ws.discountSource);
  const last = ws.history.find((h) => h.rev === ws.rev) ?? null;
  const [inputKind, setInputKind] = useState<PriceInput["kind"]>(last?.input?.kind ?? "gm");
  const [inputValue, setInputValue] = useState(
    last?.input ? String(last.input.value) : ws.targetGM !== null ? String(ws.targetGM) : "",
  );
  const [tiers, setTiers] = useState<PriceBreakTier[]>(ws.priceBreaks);
  const [dirty, setDirty] = useState(false);
  const [newRevOpen, setNewRevOpen] = useState(false);
  const touch = () => setDirty(true);

  // SAP's distributor discount for the MPG typed — suggested, never forced.
  const mpgDiscount = useMpgDistributorDiscount(mpg.trim());
  const sapMpgDiscount = mpgDiscount.data ?? null;
  const seededMpg = useRef(ws.mpg);
  useEffect(() => {
    if (mpg.trim() === seededMpg.current) return;
    seededMpg.current = mpg.trim();
    if (sapMpgDiscount !== null) {
      setDiscount(String(sapMpgDiscount));
      setDiscountSource("SAP");
    } else if (!mpgDiscount.isLoading) {
      setDiscount(String(STANDARD_DISTRIBUTOR_DISCOUNT_PCT));
      setDiscountSource("Default");
    }
  }, [mpg, sapMpgDiscount, mpgDiscount.isLoading]);

  // Unsaved changes: the browser's own prompt on close or reload.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- what the page shows --------------------------------------------------
  const shownSubs: SubAssembly[] = viewingCurrent
    ? drafts.map(draftAsSubAssembly)
    : rows.filter((r) => r.rev === viewRev).sort((a, b) => a.sortOrder - b.sortOrder);
  const discountNum = toNumber(discount) ?? STANDARD_DISTRIBUTOR_DISCOUNT_PCT;
  const inputNum = toNumber(inputValue);
  // Overhead is per row now (Ray, 2026-10-13); the worksheet-wide figure is legacy.
  const cost = useMemo(() => worksheetCost(shownSubs), [shownSubs]);
  const result = priceFromInput({
    cost: cost.unit.used,
    distributorDiscountPct: discountNum,
    input: inputNum === null ? null : { kind: inputKind, value: inputNum },
    customerDiscountPct: null,
  });
  const breaks = priceBreaks(result.listPrice, cost.unit.used, discountNum, tiers);
  const breakProblem = priceBreaksProblem(tiers);
  const snapshot = viewingCurrent ? null : ws.history.find((h) => h.rev === viewRev) ?? null;

  function doSave(asNewRevision: boolean, note: string) {
    save.mutate(
      {
        worksheet: ws,
        drafts,
        asNewRevision,
        note,
        pricing: {
          overheadPct: 0,
          mpg: mpg.trim(),
          distributorDiscountPct: discountNum,
          discountSource,
          input: inputNum === null ? null : { kind: inputKind, value: inputNum },
          priceBreaks: tiers,
        },
      },
      {
        onSuccess: () => {
          setDirty(false);
          setNewRevOpen(false);
        },
      },
    );
  }

  async function exportExcel() {
    const excel = await import("exceljs");
    const buffer = await buildWorksheetWorkbook(excel, ws, rows);
    downloadBlob(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      worksheetFileName(ws),
    );
  }

  return (
    <PricingPage wide>
      <DetailTopBar category="New Product Pricing" listTo="/sales/pricing/new-products" />

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {ws.worksheetNumber} <span className="text-base text-fg-muted">R{ws.rev}</span>
          </h1>
          <p className="mt-1 text-sm text-fg">{ws.productName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            onClick={() => void exportExcel()}
            icon={<Download className="h-4 w-4" />}
            title={dirty ? "Exports the last SAVED revision — save first to include your changes." : undefined}
          >
            Export Excel
          </ActionButton>
          {!cancelled && (
            <ActionButton
              onClick={() => {
                if (window.confirm(`Cancel ${ws.worksheetNumber}? It stays on record — nothing is deleted.`)) {
                  update.mutate({ id: ws.id, patch: { status: "Cancelled" } });
                }
              }}
              icon={<Ban className="h-4 w-4" />}
            >
              Cancel worksheet
            </ActionButton>
          )}
        </div>
      </div>

      {cancelled && (
        <div role="status" className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-fg">
          This worksheet is cancelled and can't be changed.
        </div>
      )}
      {!viewingCurrent && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg">
          You're viewing R{viewRev}, an earlier revision, read-only.
          <button type="button" onClick={() => setViewRev(ws.rev)} className="font-semibold text-accent hover:underline">
            Back to R{ws.rev}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PricingCard title="Product">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadField label="Product">{ws.productName}</ReadField>
              <ReadField label="Customer">
                {ws.customerName ? `${ws.customerName}${ws.customerSoldTo ? ` (${ws.customerSoldTo})` : ""}` : null}
              </ReadField>
              <ReadField label="Expected annual volume">{ws.expectedAnnualVolume?.toLocaleString() ?? null}</ReadField>
              <ReadField label="Description" wide>
                {ws.description}
              </ReadField>
            </dl>
          </PricingCard>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Sub-assemblies and parts {viewingCurrent ? "" : `— R${viewRev}`}
            </h2>
            {shownSubs.length === 0 && (
              <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
                Nothing here yet — add a sub-assembly (upload its CSV or add its components by hand), or add a single
                part from SAP or typed by hand.
              </p>
            )}
            {viewingCurrent
              ? drafts.map((d, i) => {
                  const onChange = (next: SubAssemblyDraft) => {
                    setDrafts((all) => all.map((x, j) => (j === i ? next : x)));
                    touch();
                  };
                  const onRemove = () => {
                    const what = d.name || (d.kind === "part" ? "this part" : "this sub-assembly");
                    if (d.lines.length && !window.confirm(`Remove "${what}" from R${ws.rev}?`)) return;
                    setDrafts((all) => all.filter((_, j) => j !== i));
                    touch();
                  };
                  return d.kind === "part" ? (
                    <PartCard key={d.key} draft={d} readOnly={readOnly} onChange={onChange} onRemove={onRemove} />
                  ) : (
                    <SubAssemblyCard
                      key={d.key}
                      draft={d}
                      readOnly={readOnly}
                      uploader={{ displayName: me.displayName, email: me.email ?? "" }}
                      onChange={onChange}
                      onRemove={onRemove}
                    />
                  );
                })
              : shownSubs.map((s) =>
                  s.kind === "part" ? (
                    <PartCard key={s.id} draft={draftFrom(s)} readOnly onChange={() => {}} onRemove={() => {}} />
                  ) : (
                    <SubAssemblyCard key={s.id} draft={draftFrom(s)} readOnly onChange={() => {}} onRemove={() => {}} uploader={{ displayName: "", email: "" }} />
                  ),
                )}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {(["subAssembly", "part"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setDrafts((d) => [
                          ...d,
                          {
                            key: newKey(),
                            id: null,
                            name: "",
                            kind,
                            altronicPartNumber: "",
                            sapPartNumber: "",
                            quantityPerProduct: 1,
                            overheadPct: null,
                            lines: [],
                            fileName: "",
                            uploadedAt: null,
                            uploadedBy: null,
                          },
                        ]);
                        touch();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"
                    >
                      <Plus className="h-3 w-3" /> {kind === "part" ? "Add part" : "Add sub-assembly"}
                    </button>
                  ))}
                </div>
              )}
          </section>

          <PricingCard title="Price">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Material price group</span>
                <input value={mpg} disabled={readOnly} onChange={(e) => { setMpg(e.target.value.toUpperCase()); touch(); }} className="input !w-36" placeholder="Optional" />
                <span className="text-[11px] text-fg-muted">Brings in SAP's distributor discount for it.</span>
              </label>
              <Num
                label="Distributor discount"
                suffix="%"
                width="!w-24"
                value={discount}
                disabled={readOnly}
                onChange={(v) => {
                  setDiscount(v);
                  setDiscountSource("Manual");
                  touch();
                }}
                hint={discountSource === "SAP" ? `SAP's for ${mpg}` : discountSource === "Default" ? `standard ${STANDARD_DISTRIBUTOR_DISCOUNT_PCT}%` : "typed"}
              />
            </div>
            {ws.overheadPct > 0 && viewingCurrent && (
              <p className="mt-3 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-3 py-2 text-xs text-fg">
                This worksheet was last saved with a {ws.overheadPct}% overhead on the whole product. Overhead is now set on
                each sub-assembly or part — add it there before saving.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div role="radiogroup" aria-label="Price from" className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
                {(["gm", "list", "customer"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={inputKind === k}
                    disabled={readOnly}
                    onClick={() => {
                      setInputKind(k);
                      setInputValue("");
                      touch();
                    }}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium", inputKind === k ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
                  >
                    {k === "gm" ? "Target GM" : k === "list" ? "List price" : "Customer price"}
                  </button>
                ))}
              </div>
              <div>
                <Num
                  label={inputKind === "gm" ? "Target base GM" : inputKind === "list" ? "List price" : "Customer price"}
                  suffix={inputKind === "gm" ? "%" : undefined}
                  prefix={inputKind === "gm" ? undefined : "$"}
                  width="!w-32"
                  hint={inputKind === "customer" ? "The distributor price; the list is worked back from it." : undefined}
                  value={inputValue}
                  disabled={readOnly}
                  onChange={(v) => {
                    setInputValue(v);
                    touch();
                  }}
                />
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-5" aria-label="Cost and price">
              <Result label="Unit cost (uploaded)" value={formatMoney(cost.unit.uploaded)} />
              <Result label="Unit cost (used)" value={formatMoney(cost.unit.used)} strong />
              <Result label="List price" value={formatMoney(result.listPrice)} strong />
              <Result label="Customer price" value={formatMoney(result.distributorPrice)} strong />
              <Result label="Base GM" value={formatPct(result.baseGM)} strong />
            </dl>
            {cost.problems.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-cooper-red">
                {cost.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {result.problem && inputValue.trim() !== "" && cost.problems.length === 0 && (
              <p className="mt-2 text-xs text-cooper-red">{result.problem}</p>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Quantity breaks</h3>
                {!readOnly && tiers.length < MAX_PRICE_BREAKS && (
                  <button
                    type="button"
                    onClick={() => {
                      const lastQty = tiers[tiers.length - 1]?.minQty ?? 1;
                      setTiers([...tiers, { minQty: lastQty < 10 ? 10 : lastQty * 5, discountPct: 5 }]);
                      touch();
                    }}
                    className="text-xs text-accent hover:underline"
                  >
                    + Add break
                  </button>
                )}
              </div>
              <table className="mt-2 w-full max-w-xl text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold">Quantity</th>
                    <th className="px-2 py-1 text-left font-semibold">From</th>
                    <th className="px-2 py-1 text-left font-semibold">% off list</th>
                    <th className="px-2 py-1 text-right font-semibold">Price each</th>
                    <th className="px-2 py-1 text-right font-semibold">Base GM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-2 py-1">{tierRanges(tiers)[0]}</td>
                    <td className="px-2 py-1 text-fg-muted">1</td>
                    <td className="px-2 py-1 text-fg-muted">—</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatMoney(result.listPrice)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatPct(result.baseGM)}</td>
                    <td />
                  </tr>
                  {tiers.map((t, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">{tierRanges(tiers)[i + 1]}</td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={2}
                          aria-label={`Break ${i + 1} quantity`}
                          value={t.minQty}
                          disabled={readOnly}
                          onChange={(e) => {
                            setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) } : x)));
                            touch();
                          }}
                          className="input !w-20 tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="any"
                          aria-label={`Break ${i + 1} discount`}
                          value={t.discountPct}
                          disabled={readOnly}
                          onChange={(e) => {
                            setTiers(tiers.map((x, j) => (j === i ? { ...x, discountPct: Number(e.target.value) } : x)));
                            touch();
                          }}
                          className="input !w-20 tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatMoney(breaks.find((b) => b.minQty === t.minQty)?.price ?? null)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatPct(breaks.find((b) => b.minQty === t.minQty)?.baseGM ?? null)}</td>
                      <td className="px-2 py-1 text-right">
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={`Remove break ${i + 1}`}
                            onClick={() => {
                              setTiers(tiers.filter((_, j) => j !== i));
                              touch();
                            }}
                            className="rounded p-0.5 text-fg-muted hover:text-cooper-red"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {breakProblem && <p className="mt-1 text-xs text-cooper-red">{breakProblem}</p>}
              <p className="mt-1 text-[11px] text-fg-muted">Each break is a % off the list price, rounded to the dollar; cost stays the same, so the margin falls at volume.</p>
            </div>
          </PricingCard>

          {snapshot && (
            <PricingCard title={`R${snapshot.rev} as saved`}>
              <p className="text-sm text-fg">
                {formatMoney(snapshot.listPrice)} list · unit cost {formatMoney(snapshot.unitCost)} (uploaded {formatMoney(snapshot.uploadedUnitCost)}) ·
                base GM {formatPct(snapshot.baseGM)}
              </p>
              {snapshot.note && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{snapshot.note}</p>}
            </PricingCard>
          )}

          <div className="min-w-0">
            <AttachmentsSection parent="newProductPricing" itemId={ws.id} />
          </div>

          <WorksheetDiscussion ws={ws} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {!readOnly && (
            <div className="sticky top-4 flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-fg-muted">{dirty ? "You have unsaved changes." : "Everything is saved."}</p>
              <button
                type="button"
                onClick={() => doSave(false, "")}
                disabled={save.isPending || !!breakProblem}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save R{ws.rev}
              </button>
              <button
                type="button"
                onClick={() => setNewRevOpen(true)}
                disabled={save.isPending || !!breakProblem}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
              >
                Save as R{ws.rev + 1}
              </button>
              <p className="text-[11px] text-fg-muted">
                Save overwrites R{ws.rev}. Save as R{ws.rev + 1} keeps R{ws.rev} exactly as it is.
              </p>
            </div>
          )}

          <WorksheetWatchers ws={ws} />
          <RevisionHistory ws={ws} viewRev={viewRev} onView={setViewRev} />
          <CompareToSap ws={ws} />
        </aside>
      </div>

      {newRevOpen && (
        <NewRevisionDialog
          rev={ws.rev + 1}
          pending={save.isPending}
          onClose={() => setNewRevOpen(false)}
          onSave={(note) => doSave(true, note)}
        />
      )}
    </PricingPage>
  );
}

function Num({
  label,
  value,
  onChange,
  disabled,
  prefix,
  suffix,
  hint,
  width,
}: {
  label: string;
  /** An important-prefixed width class (".input" sets width: 100%). */
  width?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="flex items-center gap-1">
        {prefix && <span className="text-fg-muted">{prefix}</span>}
        <input type="number" step="any" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn("input tabular-nums", width)} />
        {suffix && <span className="text-fg-muted">{suffix}</span>}
      </span>
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}

function Result({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums text-fg", strong ? "text-lg font-semibold" : "text-sm")}>{value}</dd>
    </div>
  );
}

function RevisionHistory({ ws, viewRev, onView }: { ws: NewProductWorksheet; viewRev: number; onView: (rev: number) => void }) {
  const entries = [...ws.history].reverse();
  return (
    <PricingCard title="Revisions">
      {ws.historyCorrupt && (
        <p role="alert" className="mb-2 text-xs text-cooper-red">
          The saved revision history couldn't be read — ARC won't write over it until it's checked in SharePoint.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">Not saved yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((h) => (
            <li key={h.rev}>
              <button
                type="button"
                onClick={() => onView(h.rev)}
                aria-current={h.rev === viewRev}
                className={cn(
                  "w-full rounded-lg border p-2 text-left text-sm",
                  h.rev === viewRev ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2",
                )}
              >
                <span className="font-semibold text-fg">R{h.rev}</span>
                <span className="ml-2 tabular-nums text-fg">{formatMoney(h.listPrice)}</span>
                <span className="ml-2 text-xs text-fg-muted">{formatPct(h.baseGM)} GM</span>
                <span className="block text-[11px] text-fg-muted">
                  {h.savedBy.displayName} · {new Date(h.savedAt).toLocaleDateString()}
                </span>
                {h.note && <span className="mt-0.5 block text-xs text-fg">{h.note}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </PricingCard>
  );
}

/**
 * Compare a revision's intended figures with SAP's now — read-only. The
 * comparison is by the SAP PART NUMBER typed here (Ray, 2026-10-13), which is
 * remembered on the worksheet's SapPartNumber column.
 */
function CompareToSap({ ws }: { ws: NewProductWorksheet }) {
  const update = useUpdateNewProductWorksheet();
  const [part, setPart] = useState(ws.sapPartNumber);
  const [compareRev, setCompareRev] = useState(ws.history[ws.history.length - 1]?.rev ?? ws.rev);
  const remembered = ws.sapPartNumber;
  const sap = useSapPart({ altronicPartNumber: "", sapPartNumber: remembered }, !!remembered);
  const intended = ws.history.find((h) => h.rev === compareRev) ?? null;

  if (!SAP_DATA_CONNECTED) {
    return (
      <PricingCard title="Compare to SAP">
        <p className="text-sm text-fg-muted">Available once SAP data is connected.</p>
      </PricingCard>
    );
  }
  const actual = sap.data ?? null;
  const actualGM = actual ? baseGrossMarginPct(actual.listPrice, actual.cost, intended?.distributorDiscountPct ?? STANDARD_DISTRIBUTOR_DISCOUNT_PCT) : null;
  const rows: Array<[string, string, string]> = intended
    ? [
        ["Unit cost", formatMoney(intended.unitCost), formatMoney(actual?.cost ?? null)],
        ["List price", formatMoney(intended.listPrice), formatMoney(actual?.listPrice ?? null)],
        ["Base GM", formatPct(intended.baseGM), formatPct(actualGM)],
      ]
    : [];

  return (
    <PricingCard title="Compare to SAP">
      <div className="flex gap-2">
        <input
          aria-label="SAP part number"
          placeholder="SAP part #"
          value={part}
          onChange={(e) => setPart(e.target.value)}
          className="input !min-w-0 flex-1 font-mono"
        />
        <button
          type="button"
          disabled={!part.trim() || part.trim() === remembered || update.isPending}
          onClick={() => update.mutate({ id: ws.id, patch: { sapPartNumber: part.trim() } })}
          className="rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
        >
          {remembered ? "Change" : "Remember"}
        </button>
      </div>
      {ws.history.length > 1 && (
        <label className="mt-2 flex items-center gap-2 whitespace-nowrap text-xs text-fg-muted">
          Compare
          <select value={compareRev} onChange={(e) => setCompareRev(Number(e.target.value))} className="input !h-8 !w-16 !px-2 !py-0" aria-label="Revision to compare">
            {ws.history.map((h) => (
              <option key={h.rev} value={h.rev}>
                R{h.rev}
              </option>
            ))}
          </select>
          with SAP now
        </label>
      )}
      {!remembered ? (
        <p className="mt-2 text-xs text-fg-muted">Once the product is in SAP, enter its SAP part number to compare.</p>
      ) : sap.isLoading ? (
        <p className="mt-2 text-xs text-fg-muted">Looking it up…</p>
      ) : !actual ? (
        <p className="mt-2 text-xs text-fg-muted">SAP doesn't have {remembered} yet.</p>
      ) : !intended ? (
        <p className="mt-2 text-xs text-fg-muted">Save the worksheet first.</p>
      ) : (
        <table className="mt-2 w-full text-sm" aria-label="Intended versus SAP">
          <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="py-1 text-left font-semibold" />
              <th className="py-1 text-right font-semibold">R{compareRev}</th>
              <th className="py-1 text-right font-semibold">SAP now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label} className="border-t border-border">
                <td className="py-1 text-fg-muted">{label}</td>
                <td className="py-1 text-right tabular-nums">{a}</td>
                <td className="py-1 text-right tabular-nums">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PricingCard>
  );
}

function NewRevisionDialog({
  rev,
  pending,
  onClose,
  onSave,
}: {
  rev: number;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const overlay = useOverlayDismiss(onClose, pending);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div role="dialog" aria-modal="true" aria-label={`Save as R${rev}`} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl">
        <h2 className="font-display text-lg font-semibold text-fg">Save as R{rev}</h2>
        <p className="mt-1 text-sm text-fg-muted">The current revision stays exactly as it is. Say what changed.</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input mt-3 !w-full" autoFocus aria-label="What changed" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => onSave(note)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save R{rev}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Who to suggest when @-mentioning or adding a watcher. */
function useWorksheetPeople() {
  const me = useCurrentUser();
  const directory = useDirectoryPeople();
  const { data: worksheets = [] } = useNewProductWorksheets();
  return useMemo(() => mergePeople(collectWorksheetPeople(worksheets), directory, [me]), [worksheets, directory, me]);
}

function WorksheetWatchers({ ws }: { ws: NewProductWorksheet }) {
  const setWatchers = useSetWorksheetWatchers();
  const people = useWorksheetPeople();
  function toggled(person: Person): Person[] {
    const key = personKey(person);
    return ws.watchers.some((p) => personKey(p) === key) ? ws.watchers.filter((p) => personKey(p) !== key) : [...ws.watchers, person];
  }
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Watchers</span>
      <PersonMultiField
        value={ws.watchers}
        allPeople={people}
        onToggle={(p) => setWatchers.mutate({ id: ws.id, people: toggled(p) })}
        emptyLabel="No watchers"
        searchPlaceholder="Add a watcher…"
      />
    </div>
  );
}

/** The worksheet's discussion (Ray, 2026-10-13). A pasted file goes to the worksheet's attachments. */
function WorksheetDiscussion({ ws }: { ws: NewProductWorksheet }) {
  const me = useCurrentUser();
  const people = useWorksheetPeople();
  const addComment = useAddWorksheetComment();
  const editComment = useEditWorksheetComment();
  const uploadCommentFile = useCommentFileUpload("newProductPricing", ws.id);

  function handleAddComment(bodyHtml: string) {
    // Returned, so a comment that fails to post goes back in the composer.
    return addComment
      .mutateAsync({ id: ws.id, comment: { authorName: me.displayName, authorEmail: me.email ?? "", bodyHtml } })
      .then(() => undefined);
  }

  async function handleEditComment(comment: Comment, bodyHtml: string) {
    await editComment.mutateAsync({
      id: ws.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Discussion</h2>
      <CommentComposer draftKey={`npWorksheet:${ws.id}`} uploadFile={uploadCommentFile} onSubmit={handleAddComment} mentionablePeople={people} />
      <div className="mt-5">
        <CommentThread
          uploadFile={uploadCommentFile}
          comments={ws.comments}
          currentUserEmail={me.email}
          currentUserName={me.displayName}
          mentionablePeople={people}
          onEdit={handleEditComment}
          onReply={handleAddComment}
          draftKey={`npWorksheet:${ws.id}`}
        />
      </div>
    </section>
  );
}