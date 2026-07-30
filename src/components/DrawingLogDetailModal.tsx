import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { DRAWING_LOGS } from "@/api/drawingLogs";
import { writableFields } from "@/lib/drawingLogFields";
import {
  useAppendDrawingChange,
  useDeleteDrawingLogEntry,
  useDrawingLog,
  useUpdateDrawingChange,
  useUpdateDrawingLogEntry,
} from "@/hooks/useDrawingLogs";
import { CHANGE_SLOTS, drawingLogLabel, nextFreeChangeSlot } from "@/lib/drawingLogMapper";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import type { DrawingChange, DrawingLogEntry } from "@/types/task";
import {
  DetailGrid,
  FieldInputs,
  draftFromEntry,
  draftToInput,
  suggestionsFor,
} from "./DrawingLogFields";

interface DrawingLogDetailModalProps {
  entry: DrawingLogEntry;
  /** Admins get the edit / record-change / delete controls. */
  isAdmin: boolean;
  onClose: () => void;
}

/**
 * The detail view for one drawing — what opens when a table row is clicked.
 *
 * The change log is the point of this screen. In SharePoint it's 48 columns of
 * CH_DAT/CH_ECN/CH_REV that no one can read; here it's a table of dated revisions
 * with the ECN that caused each one.
 *
 * Recording a change APPENDS to the next free slot rather than editing the
 * columns directly, because that's the only operation that makes sense on a
 * fixed-slot log — and it refuses when all 16 are used instead of overwriting the
 * oldest entry.
 *
 * Which fields show is driven by the register's descriptors, so CAD's drawing
 * number / CAD number / drawing title and CCC's part number / description are the
 * same code path.
 */
export function DrawingLogDetailModal({ entry, isAdmin, onClose }: DrawingLogDetailModalProps) {
  const spec = DRAWING_LOGS[entry.kind];
  const editable = writableFields(entry.kind);
  const updateEntry = useUpdateDrawingLogEntry(entry.kind);
  const appendChange = useAppendDrawingChange(entry.kind);
  const updateChange = useUpdateDrawingChange(entry.kind);
  const deleteEntry = useDeleteDrawingLogEntry(entry.kind);
  // Same cached query the table uses — no extra fetch.
  const { data: entries = [] } = useDrawingLog(entry.kind);
  const suggestions = suggestionsFor(entry.kind, entries);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    draftFromEntry(entry, editable),
  );
  const [addingChange, setAddingChange] = useState(false);
  /** Slot currently being corrected, if any. */
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  const freeSlot = nextFreeChangeSlot(entry.changes);
  const logFull = freeSlot === null;

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!(draft[spec.primaryKey] ?? "").trim()) {
      setError(`${spec.fields.find((f) => f.key === spec.primaryKey)?.label} is required.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updateEntry.mutateAsync({ id: entry.id, input: draftToInput(draft, editable) });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      `Delete ${drawingLogLabel(entry)} from ${spec.label}?\n\nThis removes the row and its change history from SharePoint and can't be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteEntry.mutateAsync(entry.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Drawing details"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-3xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {spec.label}
            </div>
            <h2 className="mt-0.5 font-display text-lg font-semibold text-fg">
              {drawingLogLabel(entry)}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* CAD only: the Drawing Work Sheet is CAD's paper form, and the
                other registers don't carry the By / Entered By / Software fields
                it prints. */}
            {entry.kind === "cad" && (
              <Link
                to={`/drawing-logs/cad/${entry.id}/print`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                title="Open the Drawing Work Sheet (FORM #E006) in a new tab — use Save as PDF or print it"
              >
                <Printer className="h-4 w-4" />
                Work Sheet
              </Link>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {editing ? (
          <form onSubmit={handleSaveDetails} className="flex flex-col gap-3">
            <FieldInputs
              fields={editable}
              draft={draft}
              onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
              disabled={busy}
              suggestions={suggestions}
            />
            {error && (
              <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(draftFromEntry(entry, editable));
                  setEditing(false);
                }}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save details"}
              </button>
            </div>
          </form>
        ) : (
          <DetailGrid entry={entry} fields={spec.fields} />
        )}

        {/* ---- Change log ---------------------------------------------- */}
        {spec.hasChangeLog && (
          <div className="mt-6 border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                <History className="h-4 w-4" />
                Change log
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">
                  {entry.changes.length}/{CHANGE_SLOTS}
                </span>
              </h3>
              {isAdmin && !addingChange && !editing && (
                <button
                  onClick={() => setAddingChange(true)}
                  disabled={logFull || busy}
                  title={logFull ? "All 16 change slots on this drawing are used" : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Record a change
                </button>
              )}
            </div>

            {addingChange && (
              <AddChangeForm
                slot={freeSlot ?? 0}
                onCancel={() => setAddingChange(false)}
                onSave={async (change) => {
                  setBusy(true);
                  try {
                    await appendChange.mutateAsync({ id: entry.id, change });
                    setAddingChange(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}

            {entry.changes.length === 0 ? (
              <p className="text-xs text-fg-muted">No changes recorded against this drawing.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <ChTh>Slot</ChTh>
                      <ChTh>Date</ChTh>
                      <ChTh>ECN</ChTh>
                      <ChTh>Rev</ChTh>
                      <ChTh>{""}</ChTh>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.changes.map((c) =>
                      editingSlot === c.slot ? (
                        <EditChangeRow
                          key={c.slot}
                          change={c}
                          onCancel={() => setEditingSlot(null)}
                          onSave={async (next) => {
                            setBusy(true);
                            try {
                              await updateChange.mutateAsync({
                                id: entry.id,
                                slot: c.slot,
                                change: next,
                              });
                              setEditingSlot(null);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      ) : (
                        <tr key={c.slot} className="group border-b border-border last:border-0">
                          <ChTd className="font-mono text-[11px] text-fg-muted">
                            {String(c.slot).padStart(2, "0")}
                          </ChTd>
                          <ChTd className="whitespace-nowrap tabular-nums">
                            {formatSpDate(c.date)}
                          </ChTd>
                          <ChTd>{c.ecn || "\u2014"}</ChTd>
                          <ChTd className="font-medium">{c.rev || "\u2014"}</ChTd>
                          <ChTd className="text-right">
                            {isAdmin && !editing && (
                              <button
                                type="button"
                                onClick={() => setEditingSlot(c.slot)}
                                disabled={busy}
                                aria-label={`Edit change in slot ${String(c.slot).padStart(2, "0")}`}
                                title="Correct this change"
                                className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </ChTd>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {isAdmin && entry.changes.length > 0 && (
              <p className="mt-2 text-[11px] text-fg-muted">
                Hover a change to correct it. Clearing all three values empties that
                slot and frees it for reuse.
              </p>
            )}

            {logFull && (
              <p className="mt-2 text-[11px] text-fg-muted">
                All {CHANGE_SLOTS} change slots on this drawing are used — the SharePoint list has
                no room for another. Further changes need recording in SharePoint, or more CH_
                columns adding to the list.
              </p>
            )}
          </div>
        )}

        {/* ---- Admin actions ------------------------------------------- */}
        {isAdmin && !editing && (
          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              onClick={handleDelete}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-cooper-red/50 hover:text-cooper-red disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              onClick={() => {
                setDraft(draftFromEntry(entry, editable));
                setEditing(true);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Correct one change in place.
 *
 * Clearing all three values empties the slot, which frees it for reuse — the only
 * way to undo a change recorded by mistake, since the log is a fixed sixteen slots
 * with no "remove a row".
 */
function EditChangeRow({
  change,
  onSave,
  onCancel,
}: {
  change: DrawingChange;
  onSave: (next: { date: Date | null; ecn: string; rev: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(toDateInputValue(change.date));
  const [ecn, setEcn] = useState(change.ecn);
  const [rev, setRev] = useState(change.rev);

  return (
    <tr className="border-b border-border bg-accent/5 last:border-0">
      <ChTd className="font-mono text-[11px] text-fg-muted">
        {String(change.slot).padStart(2, "0")}
      </ChTd>
      <ChTd>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Change date"
          className="select py-1"
        />
      </ChTd>
      <ChTd>
        <input
          value={ecn}
          onChange={(e) => setEcn(e.target.value)}
          aria-label="Change ECN"
          className="select py-1"
        />
      </ChTd>
      <ChTd>
        <input
          value={rev}
          onChange={(e) => setRev(e.target.value)}
          aria-label="Change revision"
          className="select w-16 py-1"
        />
      </ChTd>
      <ChTd className="whitespace-nowrap text-right">
        <button
          type="button"
          onClick={() => onSave({ date: fromDateInputValue(date), ecn, rev })}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent/90"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="ml-1 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </ChTd>
    </tr>
  );
}

/** The append-a-change form. Says which slot it's filling, since the log is fixed-size. */
function AddChangeForm({
  slot,
  onSave,
  onCancel,
}: {
  slot: number;
  onSave: (change: { date: Date | null; ecn: string; rev: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [ecn, setEcn] = useState("");
  const [rev, setRev] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mb-3 rounded-md border border-accent/40 bg-accent/5 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ecn.trim() && !rev.trim()) {
          setError("Give at least an ECN or a revision — otherwise there's nothing to record.");
          return;
        }
        setError(null);
        await onSave({ date: fromDateInputValue(date), ecn, rev });
      }}
    >
      <div className="mb-2 text-[11px] text-fg-muted">
        Recording into slot {String(slot).padStart(2, "0")} of {CHANGE_SLOTS}. A revision here also
        becomes the drawing's current revision.
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Labelled label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="select"
          />
        </Labelled>
        <Labelled label="ECN">
          <input
            value={ecn}
            onChange={(e) => setEcn(e.target.value)}
            placeholder="e.g. ECN-1187"
            className="select"
          />
        </Labelled>
        <Labelled label="Revision">
          <input
            value={rev}
            onChange={(e) => setRev(e.target.value)}
            placeholder="e.g. C"
            className="select"
          />
        </Labelled>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90"
          >
            Record
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-2 py-2 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-cooper-red">{error}</div>}
    </form>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ChTh({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </th>
  );
}

function ChTd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-fg ${className ?? ""}`}>{children}</td>;
}
