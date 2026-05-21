import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HardHat, Info, Loader2, X } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { useCreateEir } from "@/hooks/useEirs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EIR_REQUESTED_PRIORITIES,
  EIR_REQUEST_TYPES,
  type Person,
} from "@/types/task";
import { SingleSelect } from "./SearchableSelect";

interface EirFormModalProps {
  mode: "create"; // future: "edit"
  onClose: () => void;
}

/**
 * Create-EIR modal. Layout mirrors the legacy Power Apps form so users
 * coming from the SharePoint UI feel at home: General Information up top
 * (Request Type, Reporter, Requested Priority, Requested Completion Date,
 * Subject, Description) followed by Purchasing Information (EAU, Current
 * Stock, Current Price, MFG, LTB Date, MFG P/N, Altronic Part Number,
 * Where Used).
 *
 * Required-field set matches the original form too: Request Type, Reporter,
 * Requested Priority, Subject, Description.
 *
 * Everything else (Project Reference, Task Reference, Assigned Engineers,
 * Watchers, etc.) is set from the EIR detail page after creation.
 */
export function EirFormModal({ onClose }: EirFormModalProps) {
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks();
  const currentUser = useCurrentUser();
  const createEir = useCreateEir();

  // --- General Information ---
  const [requestType, setRequestType] =
    useState<(typeof EIR_REQUEST_TYPES)[number]>("EIR");
  const [reporter, setReporter] = useState<Person | null>(currentUser);
  const [requestedPriority, setRequestedPriority] = useState<
    (typeof EIR_REQUESTED_PRIORITIES)[number] | ""
  >("Medium");
  const [requestedCompletionDate, setRequestedCompletionDate] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  // --- Purchasing Information ---
  const [eau, setEau] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [mfg, setMfg] = useState("");
  const [ltbDate, setLtbDate] = useState("");
  const [mfgPartNumber, setMfgPartNumber] = useState("");
  const [altronicPartNumber, setAltronicPartNumber] = useState("");
  const [whereUsed, setWhereUsed] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const k = (p.email ?? p.displayName).toLowerCase();
        if (!map.has(k)) map.set(k, p);
      }
    }
    if (currentUser.email) {
      const k = currentUser.email.toLowerCase();
      if (!map.has(k)) map.set(k, currentUser);
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [tasks, currentUser]);

  const peopleOptions = people.map((p) => ({
    value: p.email ?? p.displayName,
    label: p.displayName,
  }));

  function findPerson(key: string | null): Person | null {
    if (!key) return null;
    return people.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  /** Cross-field required-field gate. */
  const missingRequired =
    !subject.trim() ||
    !description.trim() ||
    !reporter ||
    !requestedPriority ||
    !requestType;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return setError("Subject is required.");
    if (!description.trim()) return setError("Description is required.");
    if (!reporter) return setError("Reporter is required.");
    if (!requestedPriority) return setError("Requested Priority is required.");
    if (!requestType) return setError("Request Type is required.");
    setError(null);
    setBusy(true);
    try {
      const created = await createEir.mutateAsync({
        title: subject.trim(),
        description,
        requestType,
        status: "Under Review",
        resolution: "Pending",
        requestedPriority: requestedPriority || null,
        reporter,
        whereUsed,
        eau,
        currentStock,
        currentPrice,
        mfg,
        mfgPartNumber,
        altronicPartNumber,
        requestedCompletionDate: requestedCompletionDate
          ? new Date(requestedCompletionDate)
          : null,
        ltbDate: ltbDate ? new Date(ltbDate) : null,
      });
      onClose();
      navigate(`/eir/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create EIR.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-3xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-fg sm:text-lg">
            New Engineering Information Request
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-elegant flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {error && (
            <div className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          {/* ---- General Information ---- */}
          <SectionHeader icon={<Info className="h-4 w-4" />}>
            General Information
          </SectionHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldLabel label="Request Type" required>
              <select
                value={requestType}
                onChange={(e) =>
                  setRequestType(e.target.value as (typeof EIR_REQUEST_TYPES)[number])
                }
                className="input"
              >
                {EIR_REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Reporter" required>
              <SingleSelect
                allLabel="Enter a name or email"
                searchPlaceholder="Search people…"
                options={peopleOptions}
                selected={reporter ? reporter.email ?? reporter.displayName : null}
                onChange={(v) => setReporter(findPerson(v))}
              />
            </FieldLabel>

            <FieldLabel label="Requested Priority" required>
              <select
                value={requestedPriority}
                onChange={(e) =>
                  setRequestedPriority(
                    e.target.value as (typeof EIR_REQUESTED_PRIORITIES)[number] | "",
                  )
                }
                className="input"
              >
                <option value="">Select priority</option>
                {EIR_REQUESTED_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Requested Completion Date">
              <input
                type="date"
                value={requestedCompletionDate}
                onChange={(e) => setRequestedCompletionDate(e.target.value)}
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Subject" required className="sm:col-span-3">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoFocus
                required
                placeholder="Enter Subject"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Description" required className="sm:col-span-3">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe what you're requesting and why…"
                className="input resize-y"
              />
            </FieldLabel>
          </div>

          {/* ---- Purchasing Information ---- */}
          <SectionHeader icon={<HardHat className="h-4 w-4" />}>
            Purchasing Information
          </SectionHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldLabel label="EAU">
              <input
                value={eau}
                onChange={(e) => setEau(e.target.value)}
                placeholder="Enter EAU"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Current Stock">
              <input
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                placeholder="Enter Current Stock"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Current Price">
              <input
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                placeholder="Enter Current Price"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="MFG">
              <input
                value={mfg}
                onChange={(e) => setMfg(e.target.value)}
                placeholder="Enter Manufacturer"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="LTB Date">
              <input
                type="date"
                value={ltbDate}
                onChange={(e) => setLtbDate(e.target.value)}
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="MFG P/N">
              <input
                value={mfgPartNumber}
                onChange={(e) => setMfgPartNumber(e.target.value)}
                placeholder="Enter Manufacturer Part Number"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Altronic Part Number" className="sm:col-span-3">
              <input
                value={altronicPartNumber}
                onChange={(e) => setAltronicPartNumber(e.target.value)}
                placeholder="Enter Altronic Part Number"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Where Used" className="sm:col-span-3">
              <textarea
                value={whereUsed}
                onChange={(e) => setWhereUsed(e.target.value)}
                rows={3}
                placeholder="Where is this part used? Engines, products, jobs…"
                className="input resize-y"
              />
            </FieldLabel>
          </div>

          <p className="mt-5 text-[11px] text-fg-muted">
            Project Reference, Task Reference, Assigned Engineers, and
            Attachments are set from the EIR detail page after the EIR is
            saved.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || missingRequired}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving…" : "Save"}
          </button>
        </div>

        <style>{`
          .input {
            width: 100%;
            min-height: 38px;
            padding: 0.5rem 0.75rem;
            background: rgb(var(--surface));
            color: rgb(var(--fg));
            border: 1px solid rgb(var(--border));
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          @media (min-width: 640px) {
            .input { font-size: 0.875rem; }
          }
          .input:focus {
            outline: none;
            border-color: rgb(var(--accent));
            box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
          }
        `}</style>
      </form>
    </div>
  );
}

function SectionHeader({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h3 className="mb-3 mt-5 flex items-center gap-2 border-b border-border pb-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg first:mt-0">
      {icon}
      {children}
    </h3>
  );
}

function FieldLabel({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="flex items-baseline gap-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {required && <span className="text-cooper-red">*</span>}
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}
