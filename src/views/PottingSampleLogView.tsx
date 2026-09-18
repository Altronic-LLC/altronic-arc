import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Beaker, ChevronDown, Gauge, Mail, Plus, Settings2 } from "lucide-react";
import { useListPottingSampleEntries, usePottingLimits } from "@/hooks/usePottingSampleLog";
import { checkLimitBreach } from "@/lib/pottingSampleLog";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PottingSampleEntryFormModal } from "@/components/PottingSampleEntryFormModal";
import { cn } from "@/lib/cn";

export function PottingSampleLogView() {
  const { data: entries = [], isLoading } = useListPottingSampleEntries();
  const { data: limits } = usePottingLimits();
  const [showAddEntry, setShowAddEntry] = useState(false);

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
        <button
          type="button"
          onClick={() => setShowAddEntry(true)}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          Add entry
        </button>
        <ManageListsMenu />
      </header>

      {limits && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          Spec limits: <span className="font-semibold text-fg">{limits.lowerLimit}</span> –{" "}
          <span className="font-semibold text-fg">{limits.upperLimit}</span>
        </div>
      )}

      {showAddEntry && <PottingSampleEntryFormModal onClose={() => setShowAddEntry(false)} />}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
          <h2 className="font-medium text-fg">Entries</h2>
          <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">
            {isLoading ? "loading…" : `${entries.length} records`}
          </span>
        </div>

        {isLoading ? (
          <LoadingTasks noun="potting samples" />
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            No entries yet. Add one to get started.
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
