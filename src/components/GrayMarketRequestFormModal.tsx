import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PackageSearch, X } from "lucide-react";
import type { GrayMarketRequestInput, Person } from "@/types/task";
import {
  GRAY_MARKET_STATUSES,
  GRAY_MARKET_TESTING_REQUIRED,
  fieldsInSection,
} from "@/lib/grayMarketFields";
import { useCreateGrayMarketRequest } from "@/hooks/useGrayMarketRequests";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { toDateInputValue, fromDateInputValue } from "@/lib/spDates";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";
import { ChoicePills } from "./ChoicePills";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New Gray Market Request.
//
// Only what's needed to RAISE one: the part, who wants it, and the purchasing
// details. The engineering, inspection and production sections stay empty —
// they're filled in later, by other people, on the detail page. A create form
// carrying all thirty columns would be a wall nobody could complete.
//
// The Log No. isn't asked for: it's generated as GMR_YYYY-### on save.
//
// **Requestor defaults to the signed-in user, and is changeable** (Ray,
// 2026-09-02) — added after the person who filled out a request wasn't
// necessarily the one it should say raised it (e.g. filing on someone
// else's behalf). The hook's own `input.requestor ?? actor` fallback still
// stands as the backstop for a request submitted with no picker at all
// (there was none until now), so this form always sends an explicit value.
// =============================================================================

interface GrayMarketRequestFormModalProps {
  onClose: () => void;
  onCreated?: (id: number) => void;
}

/** The sections a NEW request fills in. The rest come later. */
const CREATE_SECTIONS = ["Request", "Purchasing"] as const;

export function GrayMarketRequestFormModal({
  onClose,
  onCreated,
}: GrayMarketRequestFormModalProps) {
  const create = useCreateGrayMarketRequest();
  const busy = create.isPending;
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<string>("Open");
  const [testingRequired, setTestingRequired] = useState<string>("");
  const [requestDate, setRequestDate] = useState<Date | null>(() =>
    fromDateInputValue(toDateInputValue(new Date())),
  );
  // Defaults to whoever's signed in; changeable, for filing on someone
  // else's behalf. Seeded once — re-deriving from `currentUser` on every
  // render would stomp a deliberate change back to the default the moment
  // the identity hook re-resolves (e.g. once its async lookupId arrives).
  const [requestor, setRequestor] = useState<Person | null>(() => currentUser);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // The signed-in user may not be in `directory` yet (a person picked from
  // the tenant directory doesn't include themselves by default), and the
  // request being filed on someone else's behalf might not be either — the
  // same "keep who's already selected in the option list" rule every
  // person picker in this app follows.
  const people = useMemo(
    () => mergePeople(directory, [currentUser], requestor ? [requestor] : []),
    [directory, currentUser, requestor],
  );

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Title and request date only. Testing Required is decided later in the
    // workflow, so a request is raised without it (Ray, 2026-08-23).
    if (!title.trim()) return setError("Title is required.");
    if (!requestDate) return setError("Request date is required.");
    setError(null);

    const input: GrayMarketRequestInput = {
      title,
      status,
      requestDate,
      testingRequired,
      requestor,
      values,
    };
    try {
      const created = await create.mutateAsync(input);
      onClose();
      onCreated?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New gray market request"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <PackageSearch className="h-4 w-4 text-accent" />
            New Gray Market Request
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

        <form
          id="gray-market-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <input
                ref={firstFieldRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Altronic assembly number"
                className="input"
              />
            </Field>

            <Field label="Request Date" required>
              <DateField
                value={toDateInputValue(requestDate)}
                onChange={(v) => setRequestDate(fromDateInputValue(v))}
                disabled={busy}
                aria-label="Request Date"
              />
            </Field>

            <Field label="Testing Required" plain>
              {/* Carries the "Not set" pill: whether testing is needed is
                  decided later in the workflow, so leaving it blank on the
                  way in is a real answer, not an omission. */}
              <ChoicePills
                label="Testing Required"
                name="new-gray-market-testing-required"
                options={GRAY_MARKET_TESTING_REQUIRED}
                value={testingRequired}
                onChange={setTestingRequired}
                allowUnset
                disabled={busy}
              />
            </Field>

            <Field label="Request Status">
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                options={GRAY_MARKET_STATUSES}
                emptyLabel="Open"
                clearable={false}
                disabled={busy}
              />
            </Field>

            <Field label="Requestor">
              <SingleSelect
                allLabel="Not set"
                ariaLabel="Requestor"
                searchPlaceholder="Search people…"
                options={people.map((p) => ({
                  value: personKey(p),
                  label: p.displayName || p.email || "Unknown",
                }))}
                selected={requestor ? personKey(requestor) : null}
                onChange={(key) =>
                  setRequestor(key ? people.find((p) => personKey(p) === key) ?? null : null)
                }
                disabled={busy}
              />
            </Field>
          </div>

          {CREATE_SECTIONS.map((section) => (
            <section key={section} className="mt-5">
              <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {section}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fieldsInSection(section).map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    // A pill group labels its own options; a <label> wrapping
                    // it would nest labels and steal the click.
                    plain={field.kind === "choice"}
                    className={
                      field.kind === "multiline" || field.kind === "richText"
                        ? "sm:col-span-2"
                        : undefined
                    }
                  >
                    {field.kind === "choice" ? (
                      <ChoicePills
                        label={field.label}
                        name={`new-gray-market-${field.key}`}
                        options={field.choices ?? []}
                        value={values[field.key] ?? ""}
                        onChange={(v) => setValue(field.key, v)}
                        disabled={busy}
                        allowUnset
                      />
                    ) : field.kind === "multiline" || field.kind === "richText" ? (
                      <AutoGrowTextarea
                        style={{ minHeight: "4.5rem" }}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        rows={2}
                        className="input resize-y"
                      />
                    ) : (
                      <input
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className="input"
                      />
                    )}
                  </Field>
                ))}
              </div>
            </section>
          ))}

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            The Log No. is assigned on save. Engineering, inspection and
            production fields, attachments and comments are added on the request
            itself.
          </p>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="gray-market-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Log request
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  /** Render a <div> instead of a <label> — for controls that label themselves. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </Wrapper>
  );
}
