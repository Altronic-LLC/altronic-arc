import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { useCreateQualityFixture, useUpdateQualityFixture } from "@/hooks/useQualityFixtures";
import type { QualityFixture, QualityFixtureInput } from "@/types/qualityFixture";
import { fixtureNumberProblem, nextFixtureNumber, qualityFixtureInputFrom } from "@/lib/qualityFixtures";
import { SuggestInput, distinctValues } from "./SuggestInput";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface QualityFixtureFormModalProps {
  /** Every fixture on the log, retired included — for the next number, the clash check and Location suggestions. */
  fixtures: QualityFixture[];
  /** Omit to add; pass a fixture to edit it. */
  fixture?: QualityFixture;
  onClose: () => void;
  /** After a new fixture is saved. */
  onCreated?: (created: QualityFixture) => void;
}

/**
 * Add or edit a fixture on the Quality Fixture Log.
 *
 * A new fixture's number starts as the next free one (one past the highest,
 * never count + 1) and can be typed over. The number is checked here against
 * the loaded log and again by the API against a fresh read. Retiring isn't a
 * field — it's the Retire button on the fixture's page.
 */
export function QualityFixtureFormModal({ fixtures, fixture, onClose, onCreated }: QualityFixtureFormModalProps) {
  const isEdit = fixture != null;
  const create = useCreateQualityFixture();
  const update = useUpdateQualityFixture();

  const [draft, setDraft] = useState<QualityFixtureInput>(() =>
    fixture
      ? qualityFixtureInputFrom(fixture)
      : { number: nextFixtureNumber(fixtures), description: "", comment: "", location: "", partNumbers: "", active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  const locations = useMemo(() => distinctValues(fixtures.map((f) => f.location)), [fixtures]);
  const others = useMemo(() => fixtures.filter((f) => f.id !== fixture?.id), [fixtures, fixture?.id]);
  const numberProblem = fixtureNumberProblem(draft.number, others);

  function set<K extends keyof QualityFixtureInput>(key: K, value: QualityFixtureInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (numberProblem) {
      setError(numberProblem);
      return;
    }
    if (!draft.description.trim()) {
      setError("A description is required — it's how people find the fixture.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isEdit) {
        await update.mutateAsync({ id: fixture.id, input: draft });
      } else {
        const created = await create.mutateAsync(draft);
        onCreated?.(created);
      }
      onClose();
    } catch {
      // The hook toasted the reason; keep the form open with what was typed.
      setError("Couldn't save to SharePoint — your changes are still here, try again.");
      setBusy(false);
    }
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${fixture.number}` : "Add a fixture"}
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {isEdit ? (
              <>
                <Pencil className="h-4 w-4 text-accent" /> Edit {fixture.number}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 text-accent" /> Add a fixture
              </>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <FieldLabel label="Fixture # *">
              <input
                ref={firstFieldRef}
                type="text"
                value={draft.number}
                onChange={(e) => set("number", e.target.value)}
                className="select"
                disabled={busy}
                aria-invalid={numberProblem ? true : undefined}
              />
            </FieldLabel>
            <FieldLabel label="Description *">
              <input
                type="text"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="e.g. Coil firing adapter"
                maxLength={255}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>
          {numberProblem && draft.number.trim() !== "" && (
            <p className="-mt-1 text-xs text-cooper-red">{numberProblem}</p>
          )}
          {!isEdit && (
            <p className="-mt-1 text-xs text-fg-muted">
              The next free number is filled in. Type over it to use another.
            </p>
          )}

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Location</span>
            <SuggestInput
              value={draft.location}
              onChange={(v) => set("location", v)}
              options={locations}
              placeholder="Where it's kept"
              disabled={busy}
              ariaLabel="Location"
            />
          </div>

          <FieldLabel label="Products / part numbers">
            <textarea
              value={draft.partNumbers}
              onChange={(e) => set("partNumbers", e.target.value)}
              rows={3}
              placeholder="What it tests — one per line"
              className={TEXTAREA_CLASS}
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Comment">
            <input
              type="text"
              value={draft.comment}
              onChange={(e) => set("comment", e.target.value)}
              maxLength={255}
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
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
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add fixture"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TEXTAREA_CLASS =
  "rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 sm:text-sm";

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
