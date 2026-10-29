import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Loader2, Trash2, X } from "lucide-react";
import type { PanelTimeOff, Person } from "@/types/task";
import { panelTimeOffProblem } from "@/api/panelTimeOff";
import { useDeletePanelTimeOff, useSavePanelTimeOff } from "@/hooks/usePanelTimeOff";
import { usePanelRoles } from "@/hooks/usePanelRoles";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { DateField } from "./DateField";
import { SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add / edit / remove a Panel Time Off entry: who, the first and last day,
// and how many hours off each day (blank = the whole day). One row covers the
// whole range — unlike Engineering's "Where am I?", which is a row per day.
//
// A panel Super User (or an ARC admin) also sees "Company holiday": no person,
// and it takes the day off EVERYONE on the Capacity view (Tim, 2026-10-29).
// Anyone else sees a holiday read-only.
// =============================================================================

interface Props {
  /** Omit to add; pass one to edit it. */
  entry?: PanelTimeOff;
  /** Whether the signed-in user may change entries (Viewers can't). */
  canEdit: boolean;
  /** A panel Super User or ARC admin: may enter and change company holidays. */
  canManageHolidays: boolean;
  /** The calendar day clicked — the first day off for a new entry. */
  defaultDate?: Date | null;
  onClose: () => void;
}

const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted";

export function PanelTimeOffFormModal({
  entry,
  canEdit,
  canManageHolidays,
  defaultDate,
  onClose,
}: Props) {
  const save = useSavePanelTimeOff();
  const remove = useDeletePanelTimeOff();
  const busy = save.isPending || remove.isPending;
  const { data: roles = [] } = usePanelRoles();
  const directory = useDirectoryPeople();

  // The panel team first; anybody in the directory can still be picked.
  const people = useMemo(
    () =>
      mergePeople(
        roles.map((r) => r.user).filter((p): p is Person => !!p?.displayName),
        entry?.person ? [entry.person] : [],
        directory,
      ),
    [roles, entry, directory],
  );

  const [personKeyValue, setPersonKeyValue] = useState<string | null>(
    entry?.person ? personKey(entry.person) : null,
  );
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [start, setStart] = useState(toDateInputValue(entry?.startDate ?? defaultDate ?? null));
  const [end, setEnd] = useState(toDateInputValue(entry?.endDate ?? null));
  const [hours, setHours] = useState(
    entry?.hoursPerDay !== null && entry?.hoursPerDay !== undefined ? String(entry.hoursPerDay) : "",
  );
  const [holiday, setHoliday] = useState(entry?.companyHoliday ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const person = people.find((p) => personKey(p) === personKeyValue) ?? null;
    const startDate = fromDateInputValue(start);
    // A blank last day means a single day off.
    const endDate = fromDateInputValue(end) ?? startDate;
    const hoursPerDay = hours.trim() === "" ? null : Number(hours);
    const input = {
      person: holiday ? null : person ?? undefined,
      reason,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      hoursPerDay,
      companyHoliday: holiday,
    };
    const problem = panelTimeOffProblem(input);
    if (problem) return setError(problem);
    setError(null);
    try {
      await save.mutateAsync({
        id: entry?.id ?? null,
        input: {
          person: holiday ? null : person,
          reason,
          startDate: startDate as Date,
          endDate: endDate as Date,
          hoursPerDay,
          companyHoliday: holiday,
        },
      });
      onClose();
    } catch {
      // The hook has already toasted the reason.
      setError("Couldn't save — see the message on screen, and try again.");
    }
  }

  async function handleDelete() {
    if (!entry) return;
    const what = entry.companyHoliday ? "this company holiday" : `${entry.person?.displayName ?? "this"} time off`;
    if (!window.confirm(`Remove ${what}?`)) return;
    try {
      await remove.mutateAsync(entry.id);
      onClose();
    } catch {
      setError("Couldn't remove it.");
    }
  }

  // A holiday is everyone's: only the people who may enter one may change it.
  const readOnly = !canEdit || (!!entry?.companyHoliday && !canManageHolidays);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry ? "Edit time off" : "Add time off"}
        onClick={(e) => e.stopPropagation()}
        className="mt-[10vh] flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <CalendarOff className="h-4 w-4 text-accent" />
            {entry?.companyHoliday ? "Company holiday" : entry ? "Time off" : "Add time off"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="panel-time-off-form" onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          {canManageHolidays && (
            <label className="flex items-start gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={holiday}
                onChange={(e) => setHoliday(e.target.checked)}
                disabled={busy || readOnly}
              />
              <span>
                <span className="font-medium">Company holiday</span>
                <span className="block text-xs text-fg-muted">
                  Everyone on the capacity grid is off — no person to pick.
                </span>
              </span>
            </label>
          )}

          {holiday ? (
            !canManageHolidays && (
              <p className="text-sm text-fg-muted">
                A company holiday — everyone is off. Only a panel Super User or an ARC admin can change it.
              </p>
            )
          ) : (
            <div>
              <span className={LABEL}>
                Who<span className="ml-1 text-cooper-red">*</span>
              </span>
              <SingleSelect
                allLabel="Pick a person"
                searchPlaceholder="Search people…"
                ariaLabel="Who"
                options={people.map((p) => ({ value: personKey(p), label: p.displayName }))}
                selected={personKeyValue}
                onChange={setPersonKeyValue}
                disabled={busy || readOnly}
              />
            </div>
          )}

          <label className="block">
            <span className={LABEL}>Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Vacation, training, doctor"
              className="input"
              disabled={busy || readOnly}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className={LABEL}>
                First day<span className="ml-1 text-cooper-red">*</span>
              </span>
              <DateField value={start} onChange={setStart} disabled={busy || readOnly} aria-label="First day" />
            </div>
            <div>
              <span className={LABEL}>Last day</span>
              <DateField
                value={end}
                onChange={setEnd}
                disabled={busy || readOnly}
                placeholder="Same day"
                aria-label="Last day"
              />
            </div>
          </div>

          <label className="block">
            <span className={LABEL}>Hours off each day</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Blank = the whole day"
              className="input"
              disabled={busy || readOnly}
            />
            <span className="mt-1 block text-xs text-fg-muted">
              A whole day off moves that person's task hours onto the days around it. A part day
              only lowers that day's capacity.
            </span>
          </label>

          {readOnly && (
            <p className="text-xs text-fg-muted">Viewers can look but not change time off.</p>
          )}
          {error && <p className="text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {entry && !readOnly ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-cooper-red/40 hover:text-cooper-red disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button
                type="submit"
                form="panel-time-off-form"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {entry ? "Save" : "Add"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
