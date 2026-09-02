import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Beaker, ChevronDown, Gauge, Mail, Plus, Settings2 } from "lucide-react";
import {
  useCreatePottingSampleEntry,
  useListPottingSampleEntries,
  usePottingLimits,
} from "@/hooks/usePottingSampleLog";
import { checkLimitBreach, DEFAULT_POTTING_VOLUME } from "@/lib/pottingSampleLog";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { cn } from "@/lib/cn";
import { isPermissionDenied } from "@/lib/listWriteErrors";

function nowForDatetimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function PottingSampleLogView() {
  const { data: entries = [], isLoading, error: entriesError, refetch } = useListPottingSampleEntries();
  const { data: limits, error: limitsError, refetch: refetchLimits } = usePottingLimits();
  const createMutation = useCreatePottingSampleEntry();
  const listUnavailable = [entriesError, limitsError].some(
    (queryError) => queryError && isPermissionDenied(queryError),
  );

  const [dateInput, setDateInput] = useState(nowForDatetimeLocal());
  const [volume, setVolume] = useState(String(DEFAULT_POTTING_VOLUME));
  const [weight, setWeight] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (weight.trim() === "") return;

    await createMutation.mutateAsync({
      date: new Date(dateInput).toISOString(),
      volume: Number(volume) || 0,
      weight: Number(weight),
    });

    setDateInput(nowForDatetimeLocal());
    setVolume(String(DEFAULT_POTTING_VOLUME));
    setWeight("");
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Beaker className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Potting Sample Log
          </h1>
          <p className="text-sm text-fg-muted">
            Record a potting sample's weight. Out-of-limit samples email the PSR notification list.
          </p>
        </div>
        <ManageListsMenu />
      </header>

      {limits && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          Spec limits: <span className="font-semibold text-fg">{limits.lowerLimit}</span> –{" "}
          <span className="font-semibold text-fg">{limits.upperLimit}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3"
      >
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          Date
          <input
            type="datetime-local"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            required
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          Volume
          <input
            type="number"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            required
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          Weight
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Enter weight"
            required
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
          />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={createMutation.isPending || listUnavailable}
            title={listUnavailable ? "You do not have access to a required SharePoint list" : undefined}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {createMutation.isPending ? "Saving…" : "Save entry"}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
          <h2 className="font-medium text-fg">Entries</h2>
          <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">
            {isLoading ? "loading…" : `${entries.length} records`}
          </span>
        </div>

        {isLoading ? (
          <LoadingTasks noun="potting samples" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice
              list="Potting Sample Log or its reference list"
              site="Altronic_PMO"
              onRetry={() => void Promise.all([refetch(), refetchLimits()])}
            />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            No entries yet. Save one above to get started.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Volume</th>
                <th className="px-4 py-2">Weight</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const breach = limits ? checkLimitBreach(entry.weight, limits) : null;
                return (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="px-4 py-2 text-fg-muted">
                      {new Date(entry.date).toLocaleString("en-US", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-2">{entry.volume}</td>
                    <td className={`px-4 py-2 font-medium ${breach ? "text-cooper-red" : "text-fg"}`}>
                      {entry.weight}
                    </td>
                    <td className="px-4 py-2">
                      {breach && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-cooper-red">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {breach === "below-lower" ? "Below lower limit" : "Above upper limit"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * "Manage lists" dropdown — the way in to the two reference lists (spec
 * limits + PSR notification list), editable by any signed-in user. Mirrors
 * TeradyneLogView's ManageListsMenu.
 */
function ManageListsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { to: "/coils/potting-limits", label: "Spec Limits", icon: <Gauge className="h-4 w-4" /> },
    { to: "/coils/psr-notifications", label: "PSR Notification List", icon: <Mail className="h-4 w-4" /> },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium transition-colors",
          open ? "border-accent text-fg" : "text-fg-muted hover:text-fg",
        )}
      >
        <Settings2 className="h-4 w-4" />
        <span className="hidden sm:inline">Manage lists</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Reference lists
          </div>
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-2"
            >
              <span className="text-fg-muted">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
