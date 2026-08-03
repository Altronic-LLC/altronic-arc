import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import {
  useCreateTeradyneLogEntry,
  useTeradyneEmployees,
  useTeradyneProducts,
  useTeradyneRemarks,
  useUpdateTeradyneLogEntry,
} from "@/hooks/useTeradyne";
import type { TeradyneEmployee, TeradyneLogEntry, TeradyneLogInput } from "@/types/task";
import { fromDateInputValue, toDateInputValue } from "@/lib/teradyneMapper";
import { SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface TeradyneLogFormModalProps {
  /** Omit to create; pass an entry to edit it. */
  entry?: TeradyneLogEntry;
  onClose: () => void;
}

/**
 * Create/edit form for a Teradyne Log entry.
 *
 * Two behaviours worth knowing:
 *  - The log's `Title` is app-derived ("{Product} - {Defective Parts}"), so
 *    there's no Title input and nothing on screen about it — it's assembled when
 *    the entry is saved. A preview of it used to sit mid-form; it only restated
 *    two fields the user had just filled in (Ray, 2026-07-30). Product is still
 *    required, because half the name comes from it.
 *  - Name and clock number are TWO WAYS TO PICK THE SAME PERSON, and each fills
 *    the other. Pick a name and the clock number appears; pick a clock number
 *    and the name appears. The log stores a denormalised copy of the clock
 *    number (that's how the source data does it), but neither box is free text:
 *    both choose from the Employees list, so an entry can't end up with a clock
 *    number that disagrees with the employee record. A number is still
 *    maintained in one place — Manage lists → Employees.
 */
export function TeradyneLogFormModal({ entry, onClose }: TeradyneLogFormModalProps) {
  const isEdit = entry != null;
  const { data: products = [] } = useTeradyneProducts();
  const { data: employees = [] } = useTeradyneEmployees();
  const { data: remarks = [] } = useTeradyneRemarks();
  const createEntry = useCreateTeradyneLogEntry();
  const updateEntry = useUpdateTeradyneLogEntry();

  const [enterDate, setEnterDate] = useState(() =>
    isEdit ? toDateInputValue(entry.enterDate) : toDateInputValue(new Date()),
  );
  const [productId, setProductId] = useState<string | null>(
    entry?.product ? String(entry.product.lookupId) : null,
  );
  const [defectiveParts, setDefectiveParts] = useState(entry?.defectiveParts ?? "");
  const [remarkId, setRemarkId] = useState<string | null>(
    entry?.remark ? String(entry.remark.lookupId) : null,
  );
  const [employee1Id, setEmployee1Id] = useState<string | null>(
    entry?.employee1 ? String(entry.employee1.lookupId) : null,
  );
  const [employee2Id, setEmployee2Id] = useState<string | null>(
    entry?.employee2 ? String(entry.employee2.lookupId) : null,
  );
  const [employee1Clock, setEmployee1Clock] = useState(numToInput(entry?.employee1Clock));
  const [employee2Clock, setEmployee2Clock] = useState(numToInput(entry?.employee2Clock));
  const [numberOfBoards, setNumberOfBoards] = useState(numToInput(entry?.numberOfBoards));
  const [boardsTested, setBoardsTested] = useState(numToInput(entry?.boardsTested));
  const [failuresPerBoard, setFailuresPerBoard] = useState(numToInput(entry?.failuresPerBoard));
  const [sapNumber, setSapNumber] = useState(entry?.sapNumber ?? "");
  const [altronicPartNumber, setAltronicPartNumber] = useState(entry?.altronicPartNumber ?? "");
  const [operatorNotes, setOperatorNotes] = useState(entry?.operatorNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

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

  // Passed to the mutation so the entry's derived name can be built without a
  // re-read. Not shown anywhere: the name is assembled in the background from
  // the product and defective parts, so previewing it just restated two fields
  // the user had already filled in (Ray, 2026-07-30).
  const productTitle = useMemo(
    () => products.find((p) => String(p.lookupId) === productId)?.title ?? null,
    [products, productId],
  );

  /**
   * The clock-number picker's options: the numbers, and nothing else.
   *
   * No name on the label — the Employee box sits right beside this one and fills
   * in as soon as a number is picked, so repeating the name here would say the
   * same thing twice (Ray, 2026-07-30).
   *
   * Deduped because the legacy import can carry the same number twice — two
   * options with the same value would make the picker ambiguous about which
   * person a click meant. Sorted numerically, since someone looking for 88 is
   * scanning numbers.
   */
  const clockOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of employees) {
      if (e.clockNum === null) continue;
      seen.add(String(e.clockNum));
    }
    return [...seen]
      .sort((a, b) => Number(a) - Number(b))
      .map((clock) => ({ value: clock, label: clock }));
  }, [employees]);

  /**
   * Pick an employee → fill that slot's clock number from their record.
   *
   * The clock state is seeded from the entry being edited rather than re-derived
   * on open, so an old entry keeps the clock number it was logged with; it only
   * changes when someone actually changes the employee on the entry.
   */
  function pickEmployee(slot: 1 | 2, value: string | null) {
    const setId = slot === 1 ? setEmployee1Id : setEmployee2Id;
    const setClock = slot === 1 ? setEmployee1Clock : setEmployee2Clock;
    setId(value);
    if (value === null) {
      setClock("");
      return;
    }
    const match = employees.find((e) => String(e.lookupId) === value);
    setClock(match?.clockNum != null ? String(match.clockNum) : "");
  }

  /**
   * Pick a clock number → fill in whose it is. The mirror image of
   * pickEmployee, because on the floor people identify themselves by either.
   *
   * Clearing the number clears the name too: both boxes are the same person, so
   * leaving a name behind a cleared number would be the mismatch this design
   * exists to prevent.
   */
  function pickClock(slot: 1 | 2, value: string | null) {
    const setId = slot === 1 ? setEmployee1Id : setEmployee2Id;
    const setClock = slot === 1 ? setEmployee1Clock : setEmployee2Clock;
    setClock(value ?? "");
    if (value === null) {
      setId(null);
      return;
    }
    const match = employees.find((e) => e.clockNum !== null && String(e.clockNum) === value);
    setId(match ? String(match.lookupId) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      // Deliberately not the same words as the picker's own "Pick a product"
      // placeholder — an error that echoes the placeholder verbatim reads like
      // a glitch rather than an instruction.
      setError("Choose a product above — the entry's name is built from it.");
      return;
    }
    setError(null);
    setBusy(true);

    const input: TeradyneLogInput = {
      enterDate: fromDateInputValue(enterDate),
      productLookupId: toIntOrNull(productId),
      employee1LookupId: toIntOrNull(employee1Id),
      employee2LookupId: toIntOrNull(employee2Id),
      remarkLookupId: toIntOrNull(remarkId),
      employee1Clock: inputToNum(employee1Clock),
      employee2Clock: inputToNum(employee2Clock),
      defectiveParts,
      numberOfBoards: inputToNum(numberOfBoards),
      boardsTested: inputToNum(boardsTested),
      failuresPerBoard: inputToNum(failuresPerBoard),
      sapNumber,
      altronicPartNumber,
      operatorNotes,
    };
    const titles = {
      productTitle,
      employee1Title: employees.find((x) => String(x.lookupId) === employee1Id)?.title ?? null,
      employee2Title: employees.find((x) => String(x.lookupId) === employee2Id)?.title ?? null,
      remarkTitle: remarks.find((x) => String(x.lookupId) === remarkId)?.title ?? null,
    };

    try {
      if (isEdit) await updateEntry.mutateAsync({ id: entry.id, input, titles });
      else await createEntry.mutateAsync({ input, titles });
      onClose();
    } catch {
      // The hook already surfaced the reason as an error toast; keep the form
      // open with its values so nothing typed is lost.
      setError("Couldn't save to SharePoint — your entry is still here, try again.");
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {isEdit ? (
              <>
                <Pencil className="h-4 w-4 text-accent" /> Edit log entry
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 text-accent" /> New log entry
              </>
            )}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Enter Date">
              <input
                ref={firstFieldRef}
                type="date"
                value={enterDate}
                onChange={(e) => setEnterDate(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Product *">
              <SingleSelect
                allLabel="Pick a product"
                searchPlaceholder="Search products…"
                options={products.map((p) => ({
                  value: String(p.lookupId),
                  label: p.testOnStation ? `${p.title} — ${p.testOnStation}` : p.title,
                }))}
                selected={productId}
                onChange={setProductId}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Defective Parts">
            <input
              type="text"
              value={defectiveParts}
              onChange={(e) => setDefectiveParts(e.target.value)}
              placeholder="e.g. U1, R1A - via, CH2 601413"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Remark">
            <SingleSelect
              allLabel="No remark"
              searchPlaceholder="Search remarks…"
              options={remarks.map((r) => ({ value: String(r.lookupId), label: r.title }))}
              selected={remarkId}
              onChange={setRemarkId}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Employee 1">
              <SingleSelect
                allLabel="Nobody"
                searchPlaceholder="Name or clock number…"
                options={employees.map((e) => ({
                  value: String(e.lookupId),
                  label: employeeOptionLabel(e),
                }))}
                selected={employee1Id}
                onChange={(v) => pickEmployee(1, v)}
              />
            </FieldLabel>
            <FieldLabel label="Employee 1 Clock">
              <SingleSelect
                allLabel="Pick a clock number"
                searchPlaceholder="Clock number…"
                options={clockOptionsWith(clockOptions, employee1Clock)}
                selected={employee1Clock || null}
                onChange={(v) => pickClock(1, v)}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Employee 2">
              <SingleSelect
                allLabel="Nobody"
                searchPlaceholder="Name or clock number…"
                options={employees.map((e) => ({
                  value: String(e.lookupId),
                  label: employeeOptionLabel(e),
                }))}
                selected={employee2Id}
                onChange={(v) => pickEmployee(2, v)}
              />
            </FieldLabel>
            <FieldLabel label="Employee 2 Clock">
              <SingleSelect
                allLabel="Pick a clock number"
                searchPlaceholder="Clock number…"
                options={clockOptionsWith(clockOptions, employee2Clock)}
                selected={employee2Clock || null}
                onChange={(v) => pickClock(2, v)}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldLabel label="Number of Boards">
              <input
                type="number"
                value={numberOfBoards}
                onChange={(e) => setNumberOfBoards(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Boards Tested">
              <input
                type="number"
                value={boardsTested}
                onChange={(e) => setBoardsTested(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Failures per Board">
              <input
                type="number"
                value={failuresPerBoard}
                onChange={(e) => setFailuresPerBoard(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="SAP Number">
              <input
                type="text"
                value={sapNumber}
                onChange={(e) => setSapNumber(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Altronic Part Number">
              <input
                type="text"
                value={altronicPartNumber}
                onChange={(e) => setAltronicPartNumber(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Operator Notes">
            <textarea
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value)}
              rows={3}
              placeholder="What the operator saw…"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              disabled={busy}
            />
          </FieldLabel>

          {error && (
            <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * The clock options, plus a stand-in for a stored number that matches nobody on
 * the Employees list.
 *
 * The log keeps its own copy of the clock number, so an entry from years ago can
 * carry a number whose employee has since been renumbered or removed. Without a
 * stand-in option the picker would fall back to its placeholder and the entry
 * would look like it never had a clock number — then quietly save as if it
 * hadn't. Better to show the number and say it isn't recognised.
 */
export function clockOptionsWith(
  options: Array<{ value: string; label: string }>,
  stored: string,
): Array<{ value: string; label: string }> {
  if (!stored || options.some((o) => o.value === stored)) return options;
  return [{ value: stored, label: `${stored} · not on the employee list` }, ...options];
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * How an employee reads in the picker: name, clock number, then work centre.
 *
 * The clock number is in the LABEL on purpose — the picker filters on label text,
 * so including it means someone can find themselves by typing either their name
 * or their number, which is how people on the floor actually identify themselves.
 */
function employeeOptionLabel(e: TeradyneEmployee): string {
  const parts = [e.title.trim() || "(unnamed)"];
  if (e.clockNum !== null) parts.push(`#${e.clockNum}`);
  if (e.workCenter.trim()) parts.push(e.workCenter.trim());
  return parts.join(" · ");
}

function numToInput(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** "" → null so an empty numeric field clears the column instead of writing 0. */
function inputToNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}
