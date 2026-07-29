import { useEffect, useState } from "react";
import { History, Pencil, Plus, Trash2, X } from "lucide-react";
import { DRAWING_LOGS } from "@/api/drawingLogs";
import {
  useAppendDrawingChange,
  useDeleteDrawingLogEntry,
  useUpdateDrawingLogEntry,
} from "@/hooks/useDrawingLogs";
import { CHANGE_SLOTS, drawingLogLabel, nextFreeChangeSlot } from "@/lib/drawingLogMapper";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import type { DrawingLogEntry, DrawingLogInput } from "@/types/task";

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
 * CH_DAT/CH_ECN/CH_REV that no one can read; here it's a table of dated
 * revisions with the ECN that caused each one.
 *
 * Recording a change APPENDS to the next free slot rather than editing the
 * columns directly, because that's the only operation that makes sense on a
 * fixed-slot log — and it refuses when all 16 are used instead of overwriting
 * the oldest entry.
 */
export function DrawingLogDetailModal({ entry, isAdmin, onClose }: DrawingLogDetailModalProps) {
  const spec = DRAWING_LOGS[entry.kind];
  const updateEntry = useUpdateDrawingLogEntry(entry.kind);
  const appendChange = useAppendDrawingChange(entry.kind);
  const deleteEntry = useDeleteDrawingLogEntry(entry.kind);

  const [editing, setEditing] = useState(false);
  const [addingChange, setAddingChange] = useState(false);
  const [busy, setBusy] = useState(false);

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
            {entry.description && (
              <p className="mt-1 text-sm text-fg-muted">{entry.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editing ? (
          <CoreFieldsForm
            entry={entry}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              setBusy(true);
              try {
                await updateEntry.mutateAsync({ id: entry.id, input });
                setEditing(false);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Detail label={spec.hasSketchFields ? "Title" : "Drawing No."} value={entry.title} />
            {!spec.hasSketchFields && <Detail label="Part No." value={entry.partNo} />}
            {spec.hasSketchFields && (
              <Detail
                label="Sketch No."
                value={entry.sketchNumber === null ? "" : String(entry.sketchNumber)}
              />
            )}
            <Detail label="Size" value={entry.size} />
            {!spec.hasSketchFields && <Detail label="Revision" value={entry.revNo} />}
            <Detail label="Started" value={formatSpDate(entry.dateStarted)} />
            <Detail label="Last revised" value={formatSpDate(entry.dateRevised)} />
            {spec.hasSketchFields && (
              <>
                <Detail label="V Code" value={entry.vCode === null ? "" : String(entry.vCode)} />
                <Detail label="Ventura" value={entry.ventura} />
              </>
            )}
            {entry.legacyId !== null && (
              <Detail label="Legacy ID" value={String(entry.legacyId)} mono />
            )}
          </dl>
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
              {isAdmin && !addingChange && (
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
              <p className="text-xs text-fg-muted">
                No changes recorded against this drawing.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <ChTh>Slot</ChTh>
                      <ChTh>Date</ChTh>
                      <ChTh>ECN</ChTh>
                      <ChTh>Rev</ChTh>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.changes.map((c) => (
                      <tr key={c.slot} className="border-b border-border last:border-0">
                        <ChTd className="font-mono text-[11px] text-fg-muted">
                          {String(c.slot).padStart(2, "0")}
                        </ChTd>
                        <ChTd className="whitespace-nowrap tabular-nums">
                          {formatSpDate(c.date)}
                        </ChTd>
                        <ChTd>{c.ecn || "—"}</ChTd>
                        <ChTd className="font-medium">{c.rev || "—"}</ChTd>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              onClick={() => setEditing(true)}
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

/** Editable core fields. Which ones show depends on the log. */
function CoreFieldsForm({
  entry,
  onSave,
  onCancel,
}: {
  entry: DrawingLogEntry;
  onSave: (input: DrawingLogInput) => Promise<void>;
  onCancel: () => void;
}) {
  const spec = DRAWING_LOGS[entry.kind];
  const [title, setTitle] = useState(entry.title);
  const [partNo, setPartNo] = useState(entry.partNo);
  const [description, setDescription] = useState(entry.description);
  const [size, setSize] = useState(entry.size);
  const [revNo, setRevNo] = useState(entry.revNo);
  const [dateStarted, setDateStarted] = useState(toDateInputValue(entry.dateStarted));
  const [dateRevised, setDateRevised] = useState(toDateInputValue(entry.dateRevised));
  const [sketchNumber, setSketchNumber] = useState(
    entry.sketchNumber === null ? "" : String(entry.sketchNumber),
  );
  const [vCode, setVCode] = useState(entry.vCode === null ? "" : String(entry.vCode));
  const [ventura, setVentura] = useState(entry.ventura);
  const [error, setError] = useState<string | null>(null);

  const num = (raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) {
          setError(
            spec.hasSketchFields
              ? "A title is required."
              : "A drawing number is required — it's how the drawing is identified.",
          );
          return;
        }
        setError(null);
        await onSave({
          title,
          partNo,
          description,
          size,
          revNo,
          dateStarted: fromDateInputValue(dateStarted),
          dateRevised: fromDateInputValue(dateRevised),
          sketchNumber: num(sketchNumber),
          vCode: num(vCode),
          ventura,
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={spec.hasSketchFields ? "Title" : "Drawing No."}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="select" />
        </Field>
        {spec.hasSketchFields ? (
          <Field label="Sketch No.">
            <input
              type="number"
              value={sketchNumber}
              onChange={(e) => setSketchNumber(e.target.value)}
              className="select"
            />
          </Field>
        ) : (
          <Field label="Part No.">
            <input value={partNo} onChange={(e) => setPartNo(e.target.value)} className="select" />
          </Field>
        )}
      </div>

      {!spec.hasSketchFields && (
        <Field label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="select"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Size">
          <input value={size} onChange={(e) => setSize(e.target.value)} className="select" />
        </Field>
        {!spec.hasSketchFields && (
          <Field label="Revision">
            <input value={revNo} onChange={(e) => setRevNo(e.target.value)} className="select" />
          </Field>
        )}
        <Field label="Started">
          <input
            type="date"
            value={dateStarted}
            onChange={(e) => setDateStarted(e.target.value)}
            className="select"
          />
        </Field>
        <Field label="Last revised">
          <input
            type="date"
            value={dateRevised}
            onChange={(e) => setDateRevised(e.target.value)}
            className="select"
          />
        </Field>
      </div>

      {spec.hasSketchFields && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="V Code">
            <input
              type="number"
              value={vCode}
              onChange={(e) => setVCode(e.target.value)}
              className="select"
            />
          </Field>
          <Field label="Ventura">
            <input value={ventura} onChange={(e) => setVentura(e.target.value)} className="select" />
          </Field>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90"
        >
          Save details
        </button>
      </div>
    </form>
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
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="select"
          />
        </Field>
        <Field label="ECN">
          <input
            value={ecn}
            onChange={(e) => setEcn(e.target.value)}
            placeholder="e.g. ECN-1187"
            className="select"
          />
        </Field>
        <Field label="Revision">
          <input
            value={rev}
            onChange={(e) => setRev(e.target.value)}
            placeholder="e.g. C"
            className="select"
          />
        </Field>
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

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm text-fg ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
