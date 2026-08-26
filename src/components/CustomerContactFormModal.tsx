import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, User, X } from "lucide-react";
import type { CustomerContact } from "@/types/task";
import {
  useCreateCustomerContact,
  useDeleteCustomerContact,
  useUpdateCustomerContact,
} from "@/hooks/useCustomerContacts";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add / edit a Customer Contact — always scoped to the customer whose detail
// page it was opened from; `customerId` isn't a field on the form.
// =============================================================================

interface CustomerContactFormModalProps {
  customerId: number;
  /** Omit to add; pass one to edit it. */
  contact?: CustomerContact;
  onClose: () => void;
}

export function CustomerContactFormModal({
  customerId,
  contact,
  onClose,
}: CustomerContactFormModalProps) {
  const editing = Boolean(contact);
  const create = useCreateCustomerContact();
  const update = useUpdateCustomerContact();
  const remove = useDeleteCustomerContact();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phoneNumber, setPhoneNumber] = useState(contact?.phoneNumber ?? "");
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? "");
  const [contactNotes, setContactNotes] = useState(contact?.contactNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

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
    if (!name.trim()) return setError("Contact name is required.");
    setError(null);
    try {
      if (contact) {
        await update.mutateAsync({
          id: contact.id,
          changed: { name, email, phoneNumber, jobTitle, contactNotes },
        });
      } else {
        await create.mutateAsync({ name, customerId, email, phoneNumber, jobTitle, contactNotes });
      }
      onClose();
    } catch {
      setError("Couldn't save — please retry.");
    }
  }

  async function handleDelete() {
    if (!contact) return;
    if (!window.confirm(`Remove ${contact.name || "this contact"}?`)) return;
    try {
      await remove.mutateAsync(contact.id);
      onClose();
    } catch {
      setError("Couldn't remove that contact.");
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
        aria-label={editing ? "Edit contact" : "Add contact"}
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <User className="h-4 w-4 text-accent" />
            {editing ? "Edit contact" : "Add contact"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Name *">
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" disabled={busy} />
            </FieldLabel>
            <FieldLabel label="Phone Number">
              <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="input" disabled={busy} />
            </FieldLabel>
          </div>
          <FieldLabel label="Job Title">
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <FieldLabel label="Notes">
            <textarea
              value={contactNotes}
              onChange={(e) => setContactNotes(e.target.value)}
              rows={3}
              className="input resize-y"
              disabled={busy}
            />
          </FieldLabel>

          {error && <p className="text-sm text-cooper-red">{error}</p>}

          <div className="mt-2 flex items-center justify-between gap-2">
            {editing ? (
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
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? "Save" : "Add"}
              </button>
            </div>
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
