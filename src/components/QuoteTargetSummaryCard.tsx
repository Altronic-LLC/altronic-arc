import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { Quote, QuoteAssembly } from "@/types/quote";
import { quoteTargetSummary } from "@/lib/quotePricing";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { FieldEditModal } from "./FieldEditModal";

// =============================================================================
// The quote's TARGET & VOLUME summary (Ray, 2026-10-30).
//
// PER PART, never totalled (Ray, 2026-11-24): one block for each line that
// has a target or an EAU set — where our price sits against that part's
// target (and the euros it came from, when given in euros), what a year at
// its EAU is worth, and — for whoever can see cost — its GM % and GM $. Lines
// with neither are left out, and the card says how many. The maths is
// `quoteTargetSummary` (lib/quotePricing.ts); this card only lays it out.
//
// Everything here is INTERNAL: target price, EAU and Project context are
// never printed. GM % and GM $ are cost-derived, so they show only with
// `canSeeCost` — hidden, not masked, like every cost figure on the worksheet.
// Price vs target and revenue are sell-side and show to everyone.
//
// Project context is free text about the project, edited through the card's
// Edit button. It is collaboration, not something sent to the customer, so it
// is not behind the Sent-edit confirmation.
// =============================================================================

interface Props {
  quote: Quote;
  assemblies: QuoteAssembly[];
  canSeeCost: boolean;
  canEdit: boolean;
  onSaveContext: (projectContext: string) => Promise<void>;
  busy?: boolean;
}

export function QuoteTargetSummaryCard({ quote, assemblies, canSeeCost, canEdit, onSaveContext, busy }: Props) {
  const summary = useMemo(() => quoteTargetSummary(assemblies), [assemblies]);
  const [editing, setEditing] = useState(false);
  // Each part is shown on its own, and only where a target or EAU is SET on
  // it (Ray, 2026-11-24) — never added up into quote totals.
  const setLines = summary.lines.filter((l) => l.targetPrice !== null || l.estimatedEau !== null);
  const unsetCount = summary.lines.length - setLines.length;

  return (
    <section
      className="rounded-xl border border-superior-blue/30 bg-superior-blue/10 p-4 sm:p-5"
      aria-label="Target and volume"
      data-tone="target"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Target &amp; volume</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit project context"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>

      {setLines.length > 0 && (
        <ul className="space-y-3" aria-label="Target and volume by part">
          {setLines.map((l) => (
            <li
              key={l.assemblyId}
              className="rounded-lg border border-border bg-surface p-3"
              aria-label={`Line ${l.lineNo} ${partLabel(l)}`}
            >
              <p className="mb-2 text-sm font-medium text-fg">
                <span className="text-fg-muted">Line {l.lineNo}</span>
                {partLabel(l) && <span className="ml-1.5">{partLabel(l)}</span>}
              </p>
              {/* Columns fit the card, never a fixed count: the vs-target chip
                  doesn't wrap, and at six fixed columns it ran into EAU. */}
              <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
                <Stat label="Target">
                  {formatMoney(l.targetPrice)}
                  {l.targetPriceEur !== null && (
                    <span className="block text-[11px] text-fg-muted">
                      €{l.targetPriceEur.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {l.eurUsdRate !== null && ` at ${l.eurUsdRate}`}
                    </span>
                  )}
                </Stat>
                <Stat label="Our price">{formatMoney(l.unitPrice)}</Stat>
                <Stat label="vs target">
                  <VsTarget amount={l.vsTarget} pct={l.vsTargetPct} />
                </Stat>
                <Stat label="EAU">{l.estimatedEau === null ? "—" : l.estimatedEau.toLocaleString("en-US")}</Stat>
                <Stat label="Annual revenue">{formatMoney(l.annualRevenue)}</Stat>
                {canSeeCost && (
                  <Stat label="GM">
                    {formatPct(l.gmPct)}
                    {l.annualGm !== null && (
                      <span className="block text-[11px] text-fg-muted">{formatMoney(l.annualGm)} a year</span>
                    )}
                  </Stat>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-0.5 text-[11px] text-fg-muted">
        {setLines.length === 0 && summary.lines.length > 0 && (
          <p>Add a line's customer target price and estimated EAU (Edit on the line) to show it here.</p>
        )}
        {setLines.length > 0 && unsetCount > 0 && (
          <p>
            {unsetCount} line{unsetCount === 1 ? " has" : "s have"} no target or EAU set and {unsetCount === 1 ? "isn't" : "aren't"}{" "}
            shown.
          </p>
        )}
        <p>Our price is each part's unit price at its quoted quantity. Internal — none of this is printed.</p>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent">Project context</dt>
        <dd className="whitespace-pre-wrap text-sm text-fg" data-testid="project-context">
          {quote.projectContext.trim() ? quote.projectContext : <span className="text-fg-muted">Not set</span>}
        </dd>
      </div>

      {editing && (
        <FieldEditModal
          title="Edit project context"
          fields={[
            {
              key: "projectContext",
              label: "Project context",
              kind: "multiline",
              hint: "Background on the project — who, why, timing. Internal, never printed.",
            },
          ]}
          values={{ projectContext: quote.projectContext }}
          busy={busy}
          onClose={() => setEditing(false)}
          onSave={(changed) => {
            if (changed.projectContext === undefined) return setEditing(false);
            void onSaveContext(changed.projectContext).then(
              () => setEditing(false),
              () => undefined,
            );
          }}
        />
      )}
    </section>
  );
}

/** The customer's part number when there is one, else ours. */
function partLabel(l: { customerPartNumber: string; partNumber: string }): string {
  return l.customerPartNumber || l.partNumber;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent">{label}</dt>
      <dd className="text-sm tabular-nums text-fg">{children}</dd>
    </div>
  );
}

/** "+$56.11 (5.3%) above" — words carry the meaning, never colour alone. */
function VsTarget({ amount, pct }: { amount: number | null; pct: number | null }) {
  if (amount === null) return <span className="text-fg-muted">—</span>;
  const rounded = Math.round(amount * 100) / 100;
  const where = rounded > 0 ? "above" : rounded < 0 ? "below" : "at target";
  const tone =
    rounded > 0 ? "border-cooper-red/40 bg-cooper-red/5" : rounded < 0 ? "border-cooper-green/40 bg-cooper-green/10" : "border-border";
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 whitespace-nowrap text-fg ${tone}`}>
      {rounded === 0 ? (
        "At target"
      ) : (
        <>
          {formatMoney(Math.abs(rounded))}
          {pct !== null && <span className="text-fg-muted">({formatPct(Math.abs(pct))})</span>}
          <span>{where}</span>
        </>
      )}
    </span>
  );
}
