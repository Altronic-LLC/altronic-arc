import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { Quote, QuoteAssembly } from "@/types/quote";
import { quoteTargetSummary } from "@/lib/quotePricing";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { FieldEditModal } from "./FieldEditModal";

// =============================================================================
// The quote's TARGET & VOLUME summary (Ray, 2026-10-30).
//
// Where our price sits against the customer's target price, what a year at
// their estimated EAU is worth, and — for whoever can see cost — the GM % and
// GM $ that year carries. The maths is `quoteTargetSummary`
// (lib/quotePricing.ts); this card only lays it out.
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
  const anyFigures = summary.lines.some((l) => l.targetPrice !== null || l.estimatedEau !== null);

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-label="Target and volume">
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

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
        <Stat label="Our price vs target">
          <VsTarget amount={summary.vsTarget} pct={summary.vsTargetPct} />
          {summary.targetRevenue !== null && (
            <span className="block text-[11px] text-fg-muted">
              a year, against {formatMoney(summary.targetRevenue)} at their target
            </span>
          )}
        </Stat>
        <Stat label="Annual revenue at EAU">{formatMoney(summary.annualRevenue)}</Stat>
        {canSeeCost && <Stat label="GM %">{formatPct(summary.annualGmPct)}</Stat>}
        {canSeeCost && <Stat label="GM $ a year">{formatMoney(summary.annualGm)}</Stat>}
      </dl>

      {summary.lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] whitespace-nowrap text-left text-xs" aria-label="Target and volume by line">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1 font-semibold">Line</th>
                <th className="px-2 py-1 text-right font-semibold">Target</th>
                <th className="px-2 py-1 text-right font-semibold">Our price</th>
                <th className="px-2 py-1 text-right font-semibold">vs target</th>
                <th className="px-2 py-1 text-right font-semibold">EAU</th>
                <th className="px-2 py-1 text-right font-semibold">Annual revenue</th>
                {canSeeCost && <th className="px-2 py-1 text-right font-semibold">GM %</th>}
                {canSeeCost && <th className="px-2 py-1 text-right font-semibold">GM $ a year</th>}
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((l) => (
                <tr key={l.assemblyId} className="border-t border-border tabular-nums">
                  <td className="px-2 py-1 text-fg">
                    {l.lineNo}
                    {l.partNumber && <span className="ml-1.5 text-fg-muted">{l.partNumber}</span>}
                  </td>
                  <td className="px-2 py-1 text-right text-fg">{formatMoney(l.targetPrice)}</td>
                  <td className="px-2 py-1 text-right text-fg">{formatMoney(l.unitPrice)}</td>
                  <td className="px-2 py-1 text-right">
                    <VsTarget amount={l.vsTarget} pct={l.vsTargetPct} />
                  </td>
                  <td className="px-2 py-1 text-right text-fg">
                    {l.estimatedEau === null ? "—" : l.estimatedEau.toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1 text-right text-fg">{formatMoney(l.annualRevenue)}</td>
                  {canSeeCost && <td className="px-2 py-1 text-right text-fg-muted">{formatPct(l.gmPct)}</td>}
                  {canSeeCost && <td className="px-2 py-1 text-right text-fg-muted">{formatMoney(l.annualGm)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 space-y-0.5 text-[11px] text-fg-muted">
        {!anyFigures && summary.lines.length > 0 && (
          <p>Add each line's customer target price and estimated EAU (Edit on the line) to fill this in.</p>
        )}
        {anyFigures && summary.linesMissingEau > 0 && (
          <p>
            {summary.linesMissingEau} line{summary.linesMissingEau === 1 ? " has" : "s have"} no EAU or no price yet and{" "}
            {summary.linesMissingEau === 1 ? "is" : "are"} left out of the annual figures.
          </p>
        )}
        <p>Our price is each line's unit price at its quoted quantity. Internal — none of this is printed.</p>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Project context</dt>
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
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
