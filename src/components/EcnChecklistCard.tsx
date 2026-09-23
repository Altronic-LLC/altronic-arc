import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Flag,
  MinusCircle,
  Users,
} from "lucide-react";
import type { Ecn } from "@/types/task";
import {
  ECN_CHECKLIST_STATUS_LABELS,
  answerFor,
  parseAnswers,
  progressFor,
  retiredAnswers,
  sectionProgress,
  sectionsWithItems,
  type EcnChecklistAnswer,
  type EcnChecklistStatus,
} from "@/lib/ecnChecklist";
import { itemsInSection, type EcnChecklistItem } from "@/lib/ecnChecklistTemplate";
import { hasRaci } from "@/lib/ecnChecklistRaci";
import {
  useChecklistForEcn,
  useCreateEcnChecklist,
  useEcnChecklistsConfigured,
  useSaveChecklistAnswers,
} from "@/hooks/useEcnChecklists";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { EcnRaciModal } from "./EcnRaciModal";
import { cn } from "@/lib/cn";

// =============================================================================
// The Cross-Functional ECN Checklist (Form# MFGFRM-038) on an ECN's page.
//
// Renders at the BOTTOM of the ECN detail view (Ray, 2026-09-15), collapsed to
// a progress summary until somebody opens it — 84 items expanded by default
// would bury the ECN's own fields.
//
// **Auto-save, no Save button** — on blur, and after a short pause in typing.
// The text being typed lives in local state so the network never stutters the
// cursor; the write is debounced so ticking twenty boxes is a handful of
// merged writes rather than twenty.
//
// **Four states, not a bare tick** — see the note in `lib/ecnChecklist.ts`.
// They render as pills rather than a dropdown: this is the primary
// interaction, 84 times over, and a dropdown per row would be brutal. (It is
// four options, past `ChoicePills`' `MAX_PILL_OPTIONS` of 3, so it is its own
// control rather than a bent version of that one.)
// =============================================================================

/** How long typing pauses before the findings text is written. */
const FINDINGS_SAVE_DELAY_MS = 1500;

const STATUS_ORDER: EcnChecklistStatus[] = ["complete", "na", "flagged", "notStarted"];

function statusTone(status: EcnChecklistStatus, active: boolean): string {
  if (!active) return "border-border bg-surface text-fg-muted hover:bg-muted";
  switch (status) {
    case "complete":
      return "border-cooper-green/40 bg-cooper-green/15 text-cooper-green";
    case "na":
      return "border-border bg-muted text-fg-muted";
    case "flagged":
      return "border-ajax-yellow/50 bg-ajax-yellow/15 text-ajax-yellow-fg";
    default:
      return "border-border bg-surface text-fg";
  }
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full", percent === 100 ? "bg-cooper-green" : "bg-accent")}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** One checklist item: the badges, the four-state control, the findings box. */
function ChecklistRow({
  item,
  answer,
  onChange,
  onShowRaci,
}: {
  item: EcnChecklistItem;
  answer: EcnChecklistAnswer;
  onChange: (next: EcnChecklistAnswer) => void;
  onShowRaci: (itemKey: string) => void;
}) {
  // The findings text is LOCAL while typing — the write is debounced behind
  // it, so a slow network never stutters the cursor.
  const [draft, setDraft] = useState(answer.findings);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answer);
  latest.current = answer;

  // Re-seed only when the STORED value changes away from what we're showing —
  // re-seeding on every render would wipe whatever is half-typed.
  useEffect(() => {
    setDraft(answer.findings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer.findings]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const commitFindings = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (text === latest.current.findings) return;
      onChange({ ...latest.current, findings: text });
    },
    [onChange],
  );

  function onDraftChange(text: string) {
    setDraft(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitFindings(text), FINDINGS_SAVE_DELAY_MS);
  }

  const showRaci = hasRaci(item.key);

  return (
    <li className="border-t border-border px-3 py-3 first:border-t-0 sm:px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.onEcn && (
          <span
            className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-accent"
            title="Column A on the form — details MUST be on the ECN."
          >
            Must be on ECN
          </span>
        )}
        {item.requiresReview && (
          <span
            className="rounded border border-ajax-yellow/40 bg-ajax-yellow/10 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ajax-yellow-fg"
            title="Column D on the form — needs a department review before the ECN is released."
          >
            Needs department review
          </span>
        )}
        {showRaci && (
          <button
            type="button"
            onClick={() => onShowRaci(item.key)}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.65rem] font-medium text-fg-muted hover:bg-muted hover:text-fg"
            title="Who is involved in this step (RACI)"
          >
            <Users className="h-3 w-3" />
            RACI
          </button>
        )}
      </div>

      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg">{item.text}</p>

      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Status">
        {STATUS_ORDER.map((status) => {
          const active = answer.status === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...answer, status })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                statusTone(status, active),
              )}
            >
              {ECN_CHECKLIST_STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      <label className="mt-2 block">
        <span className="sr-only">Findings / comments</span>
        <AutoGrowTextarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => commitFindings(draft)}
          placeholder="Findings / comments"
          rows={1}
          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
          style={{ minHeight: "2.25rem" }}
        />
      </label>
    </li>
  );
}

export function EcnChecklistCard({ ecn }: { ecn: Ecn }) {
  const configured = useEcnChecklistsConfigured();
  const { data: checklist, isLoading } = useChecklistForEcn(ecn.id);
  const create = useCreateEcnChecklist();
  const save = useSaveChecklistAnswers();

  const [open, setOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const [raciFor, setRaciFor] = useState<string | null | undefined>(undefined);

  const answers = useMemo(
    () => parseAnswers(checklist?.answersJson ?? null),
    [checklist?.answersJson],
  );
  const overall = useMemo(() => progressFor(answers), [answers]);
  const retired = useMemo(() => retiredAnswers(answers), [answers]);

  const onChange = useCallback(
    (key: string, next: EcnChecklistAnswer) => {
      if (!checklist) return;
      save.mutate({ id: checklist.id, changes: { [key]: next } });
    },
    [checklist, save],
  );

  if (!configured) {
    return (
      <section className="rounded-xl border border-ajax-yellow/40 bg-ajax-yellow/5 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
          <ClipboardList className="h-4 w-4 text-accent" />
          ECN Checklist
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Not configured yet. Run <code>scripts/create-ecn-checklist-list.ps1</code>, then set{" "}
          <code>VITE_SP_ECN_CHECKLISTS_LIST_ID</code> and redeploy.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
            <ClipboardList className="h-4 w-4 text-accent" />
            Cross-Functional ECN Checklist
            <span className="font-normal text-fg-muted">— Form# MFGFRM-038</span>
          </h2>

          {checklist ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span className="font-medium text-fg">
                  {overall.total - overall.notStarted} of {overall.total} answered
                </span>
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-cooper-green" />
                  {overall.complete} complete
                </span>
                <span className="inline-flex items-center gap-1">
                  <MinusCircle className="h-3.5 w-3.5" />
                  {overall.na} N/A
                </span>
                <span className="inline-flex items-center gap-1">
                  <Flag className="h-3.5 w-3.5 text-ajax-yellow-fg" />
                  {overall.flagged} flagged
                </span>
              </div>
              <div className="mt-2 max-w-md">
                <ProgressBar percent={overall.percent} />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">
              {isLoading
                ? "Checking for a checklist…"
                : "This ECN has no checklist yet. New ECNs get one automatically."}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setRaciFor(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-muted"
            title="The RACI matrix from the form — reference only"
          >
            <Users className="h-3.5 w-3.5" />
            Who is involved? (RACI)
          </button>

          {checklist ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-muted"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {open ? "Hide checklist" : "Open checklist"}
            </button>
          ) : (
            !isLoading && (
              <button
                type="button"
                onClick={() =>
                  create.mutate(
                    { ecnId: ecn.id, logNo: ecn.logNo },
                    { onSuccess: () => setOpen(true) },
                  )
                }
                disabled={create.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                {create.isPending ? "Creating…" : "Create checklist"}
              </button>
            )
          )}
        </div>
      </div>

      {checklist && open && (
        <div className="border-t border-border">
          <p className="px-4 py-3 text-xs text-fg-muted sm:px-5">
            Changes save on their own — there is no Save button. Mark an item{" "}
            <strong className="font-semibold text-fg">N/A</strong> when it does not apply to this
            ECN, and <strong className="font-semibold text-fg">Flagged</strong> when it needs a
            department review before release.
          </p>

          {sectionsWithItems().map((section) => {
            const items = itemsInSection(section.number);
            const p = sectionProgress(answers, section.number);
            const expanded = openSections[section.number] ?? false;
            return (
              <div key={section.number} className="border-t border-border">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((s) => ({ ...s, [section.number]: !expanded }))
                  }
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50 sm:px-5"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
                  )}
                  <span className="min-w-0 flex-1 text-sm font-medium text-fg">
                    <span className="text-fg-muted">Section {section.number}</span> —{" "}
                    {section.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      p.finished
                        ? "bg-cooper-green/15 text-cooper-green"
                        : "bg-muted text-fg-muted",
                    )}
                  >
                    {p.total - p.notStarted}/{p.total}
                  </span>
                </button>

                {expanded && (
                  <ul className="bg-bg/40">
                    {items.map((item) => (
                      <ChecklistRow
                        key={item.key}
                        item={item}
                        answer={answerFor(answers, item.key)}
                        onChange={(next) => onChange(item.key, next)}
                        onShowRaci={(k) => setRaciFor(k)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {retired.length > 0 && (
            <div className="border-t border-border bg-ajax-yellow/5 px-4 py-3 sm:px-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                No longer on the form ({retired.length})
              </h3>
              <p className="mt-1 text-xs text-fg-muted">
                Answered against an earlier revision of MFGFRM-038. Kept so nothing recorded is
                lost.
              </p>
              <ul className="mt-2 space-y-1">
                {retired.map((r) => (
                  <li key={r.key} className="text-xs text-fg">
                    <span className="font-medium">
                      {ECN_CHECKLIST_STATUS_LABELS[r.answer.status]}
                    </span>
                    {r.answer.findings && <span className="text-fg-muted"> — {r.answer.findings}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {raciFor !== undefined && (
        <EcnRaciModal onClose={() => setRaciFor(undefined)} focusItemKey={raciFor ?? undefined} />
      )}
    </section>
  );
}
