import { useEffect, useRef, useState } from "react";
import { Loader2, User, X } from "lucide-react";
import { SUPPLIER_CONTACT_STATUSES } from "@/types/task";
import { useCreateSupplierContact } from "@/hooks/useSupplierContacts";
import { ChoiceSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add a Supplier Contact — always scoped to the supplier whose detail page it
// was opened from. Created bare; everything else (notes, comments, watchers,
// attachments) is filled in on the contact's own inline card.
// =============================================================================

export function SupplierContactFormModal({
  supplierId,
  onClose,
}: {
  supplierId: number;
  onClose: () => void;
}) {
  const create = useCreateSupplierContact();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !create.isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [create.isPending, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, create.isPending);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name && !email.trim()) {
      setError("Give at least a name or an email — that's how a contact is found later.");
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({
        name,
        firstName,
        lastName,
        supplierId,
        email,
        phone,
        status: (status || null) as (typeof SUPPLIER_CONTACT_STATUSES)[number] | null,
        contactNotes: "",
        watchers: [],
      });
      onClose();
    } catch {
      setError("Couldn't add the contact — please retry.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add contact"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <User className="h-4 w-4 text-accent" />
            Add contact
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="First Name">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" disabled={create.isPending} />
            </FieldLabel>
            <FieldLabel label="Last Name">
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" disabled={create.isPending} />
            </FieldLabel>
          </div>
          <FieldLabel label="Email">
            <input ref={emailRef} value={email} onChange={(e) => setEmail(e.target.value)} className="input" disabled={create.isPending} />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" disabled={create.isPending} />
            </FieldLabel>
            <FieldLabel label="Status">
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                options={SUPPLIER_CONTACT_STATUSES}
                emptyLabel="Not set"
                disabled={create.isPending}
              />
            </FieldLabel>
          </div>

          {error && <p className="text-sm text-cooper-red">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending}
              className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
