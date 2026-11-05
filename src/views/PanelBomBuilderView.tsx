import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Eraser,
  Loader2,
  Minus,
  Package,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  usePanelBomCosts,
  usePanelBomKits,
  usePanelBomParts,
  usePanelBoms,
  useDeletePanelBom,
  useSavePanelBom,
} from "@/hooks/usePanelBom";
import { usePanelOrders } from "@/hooks/usePanelOrders";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { PANEL_BOM_PARTS_CONFIGURED } from "@/api/panelBomParts";
import { PANEL_BOMS_CONFIGURED } from "@/api/panelBoms";
import {
  bomCost,
  clusterName,
  computePanelBom,
  costOf,
  EMPTY_PICKS,
  kitCluster,
  kitCost,
  kitShown,
  panelBomCsv,
  panelBomCsvName,
  partShown,
  partsBySap,
  pickCount,
  sameBomLines,
  sapKey,
  sapPasteBlocks,
  sapPasteText,
  serializePicks,
  setPick,
  sortPanelBomKits,
  sortPanelBomParts,
  type PanelBomFilters,
} from "@/lib/panelBom";
import { PANEL_BOM_CLUSTERS, type PanelBom, type PanelBomKit, type PanelBomPart, type PanelBomPicks } from "@/types/panelBom";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PanelTeamGate } from "@/components/PanelTeamGate";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { DraftRestoredNotice } from "@/components/DraftRestoredNotice";
import { ChoiceSelect, SingleSelect } from "@/components/SearchableSelect";
import { pushToast } from "@/components/Toast";
import { isAccessDeniedError } from "@/lib/listAccess";
import { cn } from "@/lib/cn";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — /panels/bom-builder (a new BOM) and
// /panels/bom-builder/:id (a saved one). Mark Balent's standalone tool, in
// ARC: pick parts and kits, and copy SAP-ready lines (Item, L, Qty, SAP #)
// into SAP in paste-sized blocks. The rules live in lib/panelBom.ts.
//
// What changed from the standalone tool, each on purpose:
//  - The parts and kits are SharePoint lists, edited in ARC, not a snapshot
//    baked into the page.
//  - Cost is SAP's, from Fabric, per viewer — hidden when Fabric refuses.
//  - A BOM can be SAVED (and linked to a Panel Order), not only kept in one
//    browser. Unsaved work is still kept in this browser and announced when
//    it comes back.
//  - Picks are keyed by SAP # and kit name, never by row position.
// =============================================================================

type ViewKey = "all" | "kits" | `${number}`;

interface Draft {
  picks: PanelBomPicks;
  panelSystemNumber: string;
  notes: string;
  orderId: number | null;
}

const DRAFT_PREFIX = "arc:panel-bom:";
/** A draft abandoned a week ago is noise, not help — the useDraft rule. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Draft & { at?: number };
    if (!v.at || Date.now() - v.at > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_PREFIX + key);
      return null;
    }
    if (!v.picks || typeof v.picks !== "object") return null;
    return {
      picks: { parts: v.picks.parts ?? {}, kits: v.picks.kits ?? {} },
      panelSystemNumber: v.panelSystemNumber ?? "",
      notes: v.notes ?? "",
      orderId: typeof v.orderId === "number" ? v.orderId : null,
    };
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ ...draft, at: Date.now() }));
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // A lost draft is the status quo; failing the page over it would be worse.
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    serializePicks(a.picks) === serializePicks(b.picks) &&
    a.panelSystemNumber.trim() === b.panelSystemNumber.trim() &&
    a.notes === b.notes &&
    a.orderId === b.orderId
  );
}

function draftOfBom(bom: PanelBom): Draft {
  return { picks: bom.picks, panelSystemNumber: bom.panelSystemNumber, notes: bom.notes, orderId: bom.panelOrder?.lookupId ?? null };
}

const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/** "1 part", "3 parts". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Panel team only — anybody on Panel User Roles, or an ARC admin. */
export function PanelBomBuilderView() {
  return (
    <PanelTeamGate noun="the BOM builder" bom>
      <BomBuilder />
    </PanelTeamGate>
  );
}

function BomBuilder() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const id = params.id ? Number(params.id) : null;
  const draftKey = id === null ? "new" : String(id);

  const access = usePanelTeamAccess();
  const partsQ = usePanelBomParts();
  const kitsQ = usePanelBomKits();
  const bomsQ = usePanelBoms();
  const { data: orders = [] } = usePanelOrders();
  const save = useSavePanelBom();
  const remove = useDeletePanelBom();

  const parts = useMemo(() => sortPanelBomParts(partsQ.data ?? []), [partsQ.data]);
  const kits = useMemo(() => sortPanelBomKits(kitsQ.data ?? []), [kitsQ.data]);
  const bom = id === null ? null : (bomsQ.data ?? []).find((b) => b.id === id) ?? null;
  const cost = usePanelBomCosts(parts, kits);

  // ---- The draft: seeded once per BOM, from a kept draft if there is one ----
  const orderParam = Number(search.get("order"));
  const baseline: Draft | null = useMemo(() => {
    if (id === null) return { picks: EMPTY_PICKS, panelSystemNumber: "", notes: "", orderId: orderParam > 0 ? orderParam : null };
    return bom ? draftOfBom(bom) : null;
  }, [id, bom, orderParam]);

  const [draft, setDraft] = useState<Draft>({ picks: EMPTY_PICKS, panelSystemNumber: "", notes: "", orderId: null });
  const [restored, setRestored] = useState(false);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!baseline || seededFor.current === draftKey) return;
    seededFor.current = draftKey;
    const kept = readDraft(draftKey);
    if (kept && !sameDraft(kept, baseline)) {
      setDraft(kept);
      setRestored(true);
    } else {
      setDraft(baseline);
      setRestored(false);
    }
  }, [baseline, draftKey]);

  const dirty = baseline !== null && seededFor.current === draftKey && !sameDraft(draft, baseline);
  useEffect(() => {
    if (seededFor.current !== draftKey) return;
    writeDraft(draftKey, dirty ? draft : null);
  }, [draft, dirty, draftKey]);

  const result = useMemo(() => computePanelBom(parts, kits, draft.picks), [parts, kits, draft.picks]);

  // ---- Picker filters ----
  const [view, setView] = useState<ViewKey>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [standardOnly, setStandardOnly] = useState(false);
  const [hideDoNotQuote, setHideDoNotQuote] = useState(true);
  const filters: PanelBomFilters = { search: deferredQuery, preferredOnly, standardOnly, hideDoNotQuote };

  const setQty = useCallback((kind: "parts" | "kits", key: string, qty: number) => {
    setDraft((d) => ({ ...d, picks: setPick(d.picks, kind, key, qty) }));
  }, []);

  // ---- Copy blocks: ticks reset when the BOM changes ----
  const [copied, setCopied] = useState<Set<number>>(new Set());
  const signature = useMemo(() => JSON.stringify(result.lines.map((l) => [l.sapPartNumber, l.qty])), [result.lines]);
  useEffect(() => setCopied(new Set()), [signature]);
  const blocks = sapPasteBlocks(result.lines.length);

  async function copyBlock(i: number) {
    const [a, b] = blocks[i];
    await copyText(sapPasteText(result.lines.slice(a, b)));
    setCopied((prev) => new Set(prev).add(i));
    pushToast({ message: blocks.length === 1 ? "Copied — paste into SAP." : `Block ${i + 1} of ${blocks.length} copied — paste into SAP.` });
    if (i === blocks.length - 1 && result.manual.length > 0) {
      pushToast({ message: `${result.manual.length} line${result.manual.length === 1 ? "" : "s"} NOT copied — enter by hand in SAP.`, variant: "error" });
    }
  }

  function downloadCsv() {
    const blob = new Blob([panelBomCsv(result)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = panelBomCsvName(draft.panelSystemNumber);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSave(asNew: boolean) {
    try {
      const saved = await save.mutateAsync({
        id: asNew ? null : id,
        input: { panelSystemNumber: draft.panelSystemNumber, notes: draft.notes, panelOrderId: draft.orderId, picks: draft.picks, result },
      });
      writeDraft(draftKey, null);
      setRestored(false);
      if (saved.id !== id) {
        seededFor.current = null;
        navigate(`/panels/bom-builder/${saved.id}`, { replace: id === null });
      } else {
        setDraft(draftOfBom(saved));
      }
    } catch {
      // The hook has toasted why.
    }
  }

  async function handleDelete() {
    if (!bom) return;
    if (!window.confirm(`Delete the saved BOM ${bom.panelSystemNumber}? This can't be undone in ARC.`)) return;
    try {
      await remove.mutateAsync(bom.id);
      writeDraft(draftKey, null);
      navigate("/panels/boms");
    } catch {
      // Toasted.
    }
  }

  function discardDraft() {
    writeDraft(draftKey, null);
    if (baseline) setDraft(baseline);
    setRestored(false);
  }

  // ---- Grouping for the centre column ----
  const bySap = useMemo(() => partsBySap(parts), [parts]);
  const kitClusters = useMemo(() => new Map(kits.map((k) => [k.id, kitCluster(k, bySap)])), [kits, bySap]);
  const navCounts = useMemo(() => {
    const counts = new Array(PANEL_BOM_CLUSTERS.length).fill(0);
    for (const p of parts) if (p.active && !(hideDoNotQuote && p.doNotQuote)) counts[p.cluster]++;
    return counts as number[];
  }, [parts, hideDoNotQuote]);

  const blocksToShow = useMemo(() => {
    const out: Array<{ key: string; title: string; sub: string; kits: PanelBomKit[]; parts: PanelBomPart[] }> = [];
    const pickedPart = (p: PanelBomPart) => (draft.picks.parts[p.sapPartNumber] ?? 0) > 0;
    const pickedKit = (k: PanelBomKit) => (draft.picks.kits[k.name] ?? 0) > 0;
    if (view === "kits") {
      const cats = new Map<string, PanelBomKit[]>();
      for (const k of kits) if (kitShown(k, filters, pickedKit(k))) cats.set(k.category, [...(cats.get(k.category) ?? []), k]);
      for (const [cat, ks] of cats) out.push({ key: `k|${cat}`, title: cat, sub: count(ks.length, "kit"), kits: ks, parts: [] });
      return out;
    }
    const clusters = view === "all" ? PANEL_BOM_CLUSTERS.map((_, i) => i) : [Number(view)];
    for (const cl of clusters) {
      const cats = new Map<string, { kits: PanelBomKit[]; parts: PanelBomPart[] }>();
      const slot = (cat: string) => cats.get(cat) ?? (cats.set(cat, { kits: [], parts: [] }), cats.get(cat)!);
      for (const k of kits) if (kitClusters.get(k.id) === cl && kitShown(k, filters, pickedKit(k))) slot(k.category).kits.push(k);
      for (const p of parts) if (p.cluster === cl && partShown(p, filters, pickedPart(p))) slot(p.category).parts.push(p);
      for (const cat of [...cats.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
        const blk = cats.get(cat)!;
        out.push({
          key: `${cl}|${cat}`,
          title: cat,
          sub: [`Cluster ${cl} · ${clusterName(cl)}`, blk.kits.length ? count(blk.kits.length, "kit") : "", blk.parts.length ? count(blk.parts.length, "part") : ""]
            .filter(Boolean)
            .join(" · "),
          ...blk,
        });
      }
    }
    return out;
    // `filters` is rebuilt every render from the four values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, kits, parts, kitClusters, draft.picks, deferredQuery, preferredOnly, standardOnly, hideDoNotQuote]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleBlock = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- States before the builder can show ----
  if (!PANEL_BOM_PARTS_CONFIGURED) {
    return (
      <Shell>
        <p className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
          The BOM Builder's parts and kits lists aren't set up yet. Run scripts/create-panel-bom-lists.ps1, load them
          with scripts/load-panel-bom-lists.ps1, and set the list ids.
        </p>
      </Shell>
    );
  }
  if (partsQ.isPending || kitsQ.isPending || (id !== null && bomsQ.isPending)) return <LoadingTasks noun="the BOM builder" />;
  const loadError = partsQ.error ?? kitsQ.error;
  if (loadError) {
    return (
      <Shell>
        {isAccessDeniedError(loadError) ? (
          <ListAccessNotice
            list={partsQ.error ? "Panel BOM Parts" : "Panel BOM Kits"}
            site="ALTRONICPANELTEAM"
            onRetry={() => {
              void partsQ.refetch();
              void kitsQ.refetch();
            }}
          />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the parts and kits: {loadError instanceof Error ? loadError.message : String(loadError)}{" "}
            <button type="button" className="underline" onClick={() => { void partsQ.refetch(); void kitsQ.refetch(); }}>
              Try again
            </button>
          </p>
        )}
      </Shell>
    );
  }
  if (id !== null && !bom) {
    return (
      <Shell>
        <p className="text-sm text-fg-muted">
          That BOM isn't on the list — it may have been deleted. <Link to="/panels/boms" className="underline">Saved BOMs</Link>
        </p>
      </Shell>
    );
  }

  const showCost = cost.costs !== null;
  const totals = showCost ? bomCost(result.lines, cost.costs!) : null;
  const units = result.lines.reduce((a, l) => a + l.qty, 0) + result.manual.reduce((a, m) => a + m.qty, 0);
  const snapshotDiffers =
    bom !== null && !dirty && !bom.picksCorrupt && bom.savedLines.length > 0 && !sameBomLines(bom.savedLines, result.lines);
  const orderOptions = orders.map((o) => ({ value: String(o.id), label: o.projectRef?.title ? `${o.title} · ${o.projectRef.title}` : o.title }));

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-4 sm:px-6">
      {/* Header: what this BOM is, and saving it */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold text-fg">
              {bom ? `BOM ${bom.panelSystemNumber}` : "New BOM"}
              {dirty && <span className="ml-2 align-middle text-xs font-normal text-ajax-yellow">Unsaved changes</span>}
            </h1>
            <p className="text-xs text-fg-muted">
              Panel SAP BOM Builder ·{" "}
              <Link to="/panels/boms" className="underline">Saved BOMs</Link> ·{" "}
              <Link to="/panels/bom-parts" className="underline">Parts &amp; kits</Link>
              {bom?.modifiedAt && ` · last saved ${bom.modifiedAt.toLocaleString()}${bom.modifiedBy ? ` by ${bom.modifiedBy.displayName}` : ""}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-full flex-col gap-1 sm:w-56">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Panel System #</span>
            <input
              className="input h-9!"
              value={draft.panelSystemNumber}
              onChange={(e) => setDraft((d) => ({ ...d, panelSystemNumber: e.target.value }))}
              placeholder="Names the BOM and the CSV"
            />
          </label>
          <div className="flex w-full flex-col gap-1 sm:w-72">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Panel Order</span>
            <SingleSelect
              ariaLabel="Panel Order"
              allLabel="No order yet"
              searchPlaceholder="Search orders…"
              options={orderOptions}
              selected={draft.orderId === null ? null : String(draft.orderId)}
              onChange={(v) => setDraft((d) => ({ ...d, orderId: v ? Number(v) : null }))}
            />
          </div>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Notes</span>
            <input
              className="input h-9!"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Optional"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {access.canBuildBom && PANEL_BOMS_CONFIGURED && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSave(false)}
                  disabled={save.isPending || (bom !== null && !dirty)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {bom ? "Save" : "Save BOM"}
                </button>
                {bom && (
                  <button
                    type="button"
                    onClick={() => void handleSave(true)}
                    disabled={save.isPending}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
                  >
                    Save as new
                  </button>
                )}
                {bom && (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={remove.isPending}
                    aria-label="Delete this BOM"
                    title="Delete this BOM"
                    className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-2.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (pickCount(draft.picks) && window.confirm("Clear every quantity on this BOM?")) setDraft((d) => ({ ...d, picks: EMPTY_PICKS }));
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-fg hover:bg-surface-2"
            >
              <Eraser className="h-4 w-4" /> Clear
            </button>
          </div>
        </div>
        {!access.canBuildBom && access.bomHint && <p className="text-xs text-fg-muted">{access.bomHint} You can still build and copy a BOM.</p>}
        {!PANEL_BOMS_CONFIGURED && (
          <p className="text-xs text-fg-muted">Saving isn't set up yet (the Panel BOMs list) — build, copy and download still work.</p>
        )}
        {restored && (
          <DraftRestoredNotice
            onDiscard={discardDraft}
            onKeep={() => setRestored(false)}
            note={bom ? "These are changes you hadn't saved on this BOM — Discard goes back to the saved one." : undefined}
          />
        )}
        {bom?.picksCorrupt && (
          <p className="flex items-start gap-1.5 text-sm text-cooper-red">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ARC couldn't read what was picked on this saved BOM. Its saved lines are below the builder; use Save as new to keep
            a fresh copy — ARC won't save over it.
          </p>
        )}
        {snapshotDiffers && (
          <p className="flex items-start gap-1.5 text-sm text-ajax-yellow">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            The parts or kits have changed since this BOM was saved, so its SAP lines are now different from the saved ones.
            Check them, then Save to update it.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* Left: clusters */}
        <nav aria-label="Clusters" className="hidden w-56 shrink-0 flex-col gap-0.5 rounded-lg border border-border bg-surface p-2 2xl:flex">
          <NavButton on={view === "all"} onClick={() => setView("all")} label="All parts" />
          <NavButton on={view === "kits"} onClick={() => setView("kits")} label="Kits" count={kits.filter((k) => k.active).length} />
          <hr className="my-1 border-border" />
          {PANEL_BOM_CLUSTERS.map((name, i) => (
            <NavButton key={name} on={view === `${i}`} onClick={() => setView(`${i}`)} label={`${i} · ${name}`} count={navCounts[i]} />
          ))}
        </nav>

        {/* Centre: the parts and kits */}
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full 2xl:hidden">
              <ChoiceSelect
                ariaLabel="Show"
                emptyLabel="All parts"
                clearable={false}
                value={view}
                onChange={(v) => setView((v || "all") as ViewKey)}
                options={[
                  { value: "all", label: "All parts" },
                  { value: "kits", label: "Kits" },
                  ...PANEL_BOM_CLUSTERS.map((name, i) => ({ value: `${i}`, label: `${i} · ${name}` })),
                ]}
              />
            </div>
            <input
              type="search"
              aria-label="Search parts and kits"
              className="input h-9! min-w-0 flex-1"
              placeholder="Search SAP #, MFG #, kit, description, category…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <FilterChip on={preferredOnly} onClick={() => setPreferredOnly((v) => !v)} label="Preferred only" />
            <FilterChip on={standardOnly} onClick={() => setStandardOnly((v) => !v)} label="Standard only" />
            <FilterChip on={hideDoNotQuote} onClick={() => setHideDoNotQuote((v) => !v)} label="Hide Do-Not-Quote" />
          </div>
          {cost.failure && (
            <p className="text-xs text-fg-muted">
              {cost.failure.message}{" "}
              {!cost.failure.hidden && (
                <button type="button" className="underline" onClick={cost.retry}>
                  Try again
                </button>
              )}
            </p>
          )}
          {parts.length === 0 && kits.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
              The parts and kits lists are empty. If they shouldn't be, your account may not be able to see their rows — ask an admin.
            </p>
          ) : blocksToShow.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">Nothing matches.</p>
          ) : (
            blocksToShow.map((blk) => (
              <CategoryBlock
                key={blk.key}
                title={blk.title}
                sub={blk.sub}
                open={!collapsed.has(blk.key)}
                onToggle={() => toggleBlock(blk.key)}
              >
                {blk.kits.map((k) => (
                  <KitRows
                    key={`k${k.id}`}
                    kit={k}
                    qty={draft.picks.kits[k.name] ?? 0}
                    costs={cost.costs}
                    showCost={showCost || cost.loading}
                    onSet={setQty}
                  />
                ))}
                {blk.parts.map((p) => (
                  <PartRow
                    key={`p${p.id}`}
                    part={p}
                    qty={draft.picks.parts[p.sapPartNumber] ?? 0}
                    cost={showCost ? costOf(cost.costs, p.sapPartNumber) : undefined}
                    showCost={showCost || cost.loading}
                    onSet={setQty}
                  />
                ))}
              </CategoryBlock>
            ))
          )}
        </section>

        {/* Right: the SAP BOM */}
        <aside aria-label="SAP BOM" className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:w-[24rem] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">SAP BOM</h2>
            <span className="text-xs text-fg-muted">
              {count(result.lines.length + result.manual.length, "line")} · {fmtQty(units)} unit{units === 1 ? "" : "s"}
              {totals && ` · est. ${money(totals.cost, false)}`}
            </span>
          </div>
          {totals && totals.missing > 0 && (
            <p className="text-xs text-fg-muted">
              The estimate leaves out {totals.missing} line{totals.missing === 1 ? "" : "s"} SAP has no cost for. It's SAP's
              current cost, not a quote price.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {result.lines.length === 0 ? (
              <button type="button" disabled className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted opacity-60">
                <ClipboardCopy className="h-4 w-4" /> Copy for SAP
              </button>
            ) : (
              blocks.map(([a, b], i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void copyBlock(i)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
                    copied.has(i) ? "border-ajax-yellow text-fg" : "border-accent bg-accent text-white hover:bg-accent/90",
                  )}
                >
                  {copied.has(i) ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
                  {blocks.length === 1 ? `Copy for SAP (${result.lines.length})` : `${i + 1}: rows ${a + 1}–${b}`}
                </button>
              ))
            )}
            <button
              type="button"
              onClick={downloadCsv}
              disabled={result.lines.length + result.manual.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:bg-surface-2 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
          </div>
          {blocks.length > 1 && (
            <p className="text-xs text-fg-muted">SAP takes about 28 rows per paste — copy and paste each block in order.</p>
          )}
          {result.lines.length === 0 && result.manual.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">Nothing picked yet. Pick parts and kits from the list.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 font-medium">L</th>
                  <th className="py-1 pr-2 text-right font-medium">Qty</th>
                  <th className="py-1 pr-2 font-medium">SAP #</th>
                  <th className="py-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.sapPartNumber} className="border-b border-border/60 last:border-0">
                    <td className="py-1 pr-2 tabular-nums">{l.item}</td>
                    <td className="py-1 pr-2">L</td>
                    <td className="py-1 pr-2 text-right font-semibold tabular-nums">{fmtQty(l.qty)}</td>
                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{l.sapPartNumber}</td>
                    <td className="max-w-0 truncate py-1 text-fg-muted" title={l.description}>{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.manual.length > 0 && (
            <div className="rounded-md border border-cooper-red/50 bg-cooper-red/5 p-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-cooper-red">Enter in SAP by hand — not copied</h3>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {result.manual.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{fmtQty(m.qty)}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{m.partNumber || "(no part #)"}</span> {m.description}
                      <span className="block text-fg-muted">
                        {m.reason === "manual" ? "No SAP #" : "Not on the parts list, so ARC can't number it"}
                        {m.kitName ? ` · from ${m.kitName}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bom?.picksCorrupt && bom.savedLines.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Saved lines</h3>
              <ul className="mt-1 text-xs tabular-nums">
                {bom.savedLines.map((l) => (
                  <li key={l.sapPartNumber}>
                    {l.item} · {fmtQty(l.qty)} × {l.sapPartNumber} {l.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[900px] px-4 py-6">{children}</div>;
}

function NavButton({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        on ? "bg-accent/10 font-medium text-accent" : "text-fg hover:bg-surface-2",
      )}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-fg-muted">{count}</span>}
    </button>
  );
}

function FilterChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        on ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-fg-muted hover:bg-surface-2",
      )}
    >
      {label}
    </button>
  );
}

function CategoryBlock({
  title,
  sub,
  open,
  onToggle,
  children,
}: {
  title: string;
  sub: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left text-sm font-medium text-fg"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="hidden text-xs font-normal text-fg-muted sm:inline">{sub}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type SetQty = (kind: "parts" | "kits", key: string, qty: number) => void;

function QtyControl({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        className="rounded p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-30"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={`Quantity of ${label}`}
        className={cn("input h-7! w-12! px-1! text-center tabular-nums", value > 0 && "border-accent font-semibold")}
        value={value || ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      <button
        type="button"
        aria-label={`More ${label}`}
        onClick={() => onChange(value + 1)}
        className="rounded p-1 text-fg-muted hover:bg-surface-2"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Flag({ on }: { on: boolean }) {
  return on ? <span className="font-semibold text-ajax-yellow">X</span> : null;
}

/**
 * One width per column, shared by part, kit and component rows. The table is
 * `table-fixed`, so the first row's widths set the columns — every block then
 * lines up with every other. The columns that matter least drop out first as
 * the middle column narrows; the description takes what's left.
 */
const COL = {
  qty: "w-28 px-1",
  sap: "w-28 px-2 sm:w-32",
  mfg: "hidden w-28 px-2 xl:table-cell",
  qiu: "hidden w-14 px-1 text-center xl:table-cell",
  flag: "hidden w-9 px-1 text-center 2xl:table-cell",
  cost: "hidden w-24 px-2 text-right tabular-nums md:table-cell",
};

const PartRow = memo(function PartRow({
  part,
  qty,
  cost,
  showCost,
  onSet,
}: {
  part: PanelBomPart;
  qty: number;
  cost: number | null | undefined;
  showCost: boolean;
  onSet: SetQty;
}) {
  return (
    <tr className={cn("border-t border-border", (part.doNotQuote || !part.active) && "text-fg-muted", qty > 0 && "bg-accent/5")}>
      <td className={cn(COL.qty, "py-1")}>
        <QtyControl value={qty} label={part.sapPartNumber} onChange={(n) => onSet("parts", part.sapPartNumber, n)} />
      </td>
      <td className={cn(COL.sap, "py-1 tabular-nums")}>
        <span className="whitespace-nowrap">{part.sapPartNumber}</span>
        {part.doNotQuote && <span className="ml-1 inline-block rounded bg-cooper-red/10 px-1 text-[10px] font-semibold text-cooper-red">DNQ</span>}
        {!part.active && <span className="ml-1 inline-block rounded bg-surface-2 px-1 text-[10px] font-semibold">RETIRED</span>}
      </td>
      <td className={cn(COL.mfg, "truncate py-1 text-xs text-fg-muted")} title={part.altronicPartNumber}>
        {part.altronicPartNumber}
      </td>
      <td className={cn("px-2 py-1", part.preferred && "font-semibold")} title={part.datasheet ? `Datasheet: ${part.datasheet}` : undefined}>
        {part.description}
      </td>
      <td className={cn(COL.qiu, "py-1")}>
        {part.qtyIfUsed !== null && (
          <button
            type="button"
            title="Qty if used — click to use it"
            onClick={() => onSet("parts", part.sapPartNumber, part.qtyIfUsed!)}
            className="rounded px-1 text-xs text-fg-muted underline decoration-dotted hover:text-fg"
          >
            {fmtQty(part.qtyIfUsed)}
          </button>
        )}
      </td>
      <td className={cn(COL.flag, "py-1")} title="Standard"><Flag on={part.standard} /></td>
      <td className={cn(COL.flag, "py-1")} title="Preferred"><Flag on={part.preferred} /></td>
      {showCost && (
        <td className={cn(COL.cost, "py-1")}>
          {cost === undefined ? "…" : cost === null ? <span className="text-xs text-fg-muted">No SAP cost</span> : money(cost)}
        </td>
      )}
    </tr>
  );
});

const KitRows = memo(function KitRows({
  kit,
  qty,
  costs,
  showCost,
  onSet,
}: {
  kit: PanelBomKit;
  qty: number;
  costs: ReadonlyMap<string, number | null> | null;
  showCost: boolean;
  onSet: SetQty;
}) {
  const noSap = kit.components.some((c) => !c.sapPartNumber);
  const total = costs ? kitCost(kit, costs) : null;
  const colSpan = 7 + (showCost ? 1 : 0);
  return (
    <>
      <tr className={cn("border-t border-ajax-yellow/40 bg-ajax-yellow/10", qty > 0 && "bg-ajax-yellow/20")}>
        <td className={cn(COL.qty, "py-1")}>
          <QtyControl value={qty} label={kit.name} onChange={(n) => onSet("kits", kit.name, n)} />
        </td>
        <td className={cn(COL.sap, "break-words py-1 font-semibold")}>
          {kit.name}
          <span className="ml-1 inline-block rounded bg-ajax-yellow/30 px-1 text-[10px] font-semibold">KIT</span>
          {noSap && <span className="ml-1 inline-block rounded bg-cooper-red/10 px-1 text-[10px] font-semibold text-cooper-red">NON-SAP PARTS</span>}
          {!kit.active && <span className="ml-1 inline-block rounded bg-surface-2 px-1 text-[10px] font-semibold">RETIRED</span>}
        </td>
        <td className={COL.mfg} />
        <td className="px-2 py-1 font-medium">{kit.description}</td>
        <td className={COL.qiu} />
        <td className={cn(COL.flag, "py-1")} title="Standard"><Flag on={kit.standard} /></td>
        <td className={cn(COL.flag, "py-1")} title="Preferred"><Flag on={kit.preferred} /></td>
        {showCost && (
          <td className={cn(COL.cost, "py-1")} title={total?.missing ? `${total.missing} component(s) have no SAP cost` : undefined}>
            {total === null ? "…" : `${money(total.cost)}${total.missing ? "*" : ""}`}
          </td>
        )}
      </tr>
      {kit.componentsCorrupt && (
        <tr>
          <td colSpan={colSpan} className="px-2 py-1 text-xs text-cooper-red">ARC couldn't read this kit's components — fix them on Parts &amp; kits.</td>
        </tr>
      )}
      {kit.components.map((c, i) => {
        const unit = costs && c.sapPartNumber ? costs.get(sapKey(c.sapPartNumber)) : null;
        return (
          <tr key={i} className="text-xs text-fg-muted">
            <td className="px-1 py-0.5 text-center">{fmtQty(c.qty)} / kit</td>
            <td className="px-2 py-0.5 tabular-nums">{c.sapPartNumber || <span className="text-cooper-red">no SAP #</span>}</td>
            <td className={cn(COL.mfg, "truncate py-0.5")} title={c.mfgPartNumber}>{c.mfgPartNumber}</td>
            <td className="px-2 py-0.5 pl-6">{c.description}</td>
            <td className={COL.qiu} />
            <td className={COL.flag} />
            <td className={COL.flag} />
            {showCost && <td className={cn(COL.cost, "py-0.5")}>{unit != null ? money(unit) : ""}</td>}
          </tr>
        );
      })}
    </>
  );
});
