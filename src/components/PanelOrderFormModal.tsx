import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import {
  useCreatePanelOrder,
  usePanelOrderChoices,
  usePanelOrders,
  usePanelProjects,
} from "@/hooks/usePanelOrders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PanelOrder, PanelOrderStatus, Person } from "@/types/task";
import { SingleSelect } from "./SearchableSelect";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";

interface PanelOrderFormModalProps {
  onClose: () => void;
}

/**
 * Create modal for Panel Orders. The project reference dropdown reads from
 * the admin-managed Panel Project Reference list; Customer choices come from
 * the runtime column discovery (usePanelOrderChoices). New orders start as
 * "Submitted" and the creator is auto-added as a watcher.
 */
export function PanelOrderFormModal({ onClose }: PanelOrderFormModalProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: orders = [] } = usePanelOrders();
  const { data: projects = [] } = usePanelProjects();
  const { data: choices } = usePanelOrderChoices();
  const createOrder = useCreatePanelOrder();
  const directory = useDirectoryPeople();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [salesOrder, setSalesOrder] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [customer, setCustomer] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [engineerKey, setEngineerKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInputRef.current?.focus();
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

  // People directory for the Engineer picker — everyone assigned/watching
  // across panel orders, plus the signed-in user.
  const allPeople: Person[] = (() => {
    const seen = new Map<string, Person>();
    const note = (p: Person | null) => {
      if (!p || !p.displayName) return;
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!seen.has(key)) seen.set(key, p);
    };
    for (const o of orders as PanelOrder[]) {
      note(o.engineerAssigned);
      o.watchers.forEach(note);
    }
    if (currentUser.email && !seen.has(currentUser.email.toLowerCase())) {
      seen.set(currentUser.email.toLowerCase(), currentUser);
    }
    return mergePeople([...seen.values()], directory);
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Order title is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const engineer = engineerKey
        ? allPeople.find((p) => (p.email ?? p.displayName) === engineerKey) ?? null
        : null;
      const created = await createOrder.mutateAsync({
        title: trimmedTitle,
        status: "Submitted" as PanelOrderStatus,
        projectLookupId: projectId ? parseInt(projectId, 10) : null,
        salesOrder: salesOrder.trim() || undefined,
        purchaseOrder: purchaseOrder.trim() || undefined,
        customerReference: customerReference.trim() || undefined,
        customer: customer || undefined,
        customerContactEmail: contactEmail.trim() || undefined,
        orderNotes: orderNotes.trim() || undefined,
        engineerAssigned: engineer,
        watchers: [currentUser],
      });
      onClose();
      navigate(`/panels/order/${created.id}`);
    } catch {
      setError("Couldn't create the panel order — please retry.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> New Panel Order
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
          <FieldLabel label="Order Title *">
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Archrock skid panel build — June release"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Project Reference">
              <SingleSelect
                allLabel="No project"
                searchPlaceholder="Search project numbers…"
                options={projects.map((p) => ({
                  value: String(p.id),
                  label: p.description ? `${p.title} — ${p.description}` : p.title,
                }))}
                selected={projectId}
                onChange={setProjectId}
              />
            </FieldLabel>
            <FieldLabel label="Engineer Assigned">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={engineerKey}
                onChange={setEngineerKey}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Sales Order">
              <input
                type="text"
                value={salesOrder}
                onChange={(e) => setSalesOrder(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Purchase Order">
              <input
                type="text"
                value={purchaseOrder}
                onChange={(e) => setPurchaseOrder(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Customer">
              <SingleSelect
                allLabel="Not set"
                searchPlaceholder="Search customers…"
                options={(choices?.customer ?? []).map((c) => ({ value: c, label: c }))}
                selected={customer || null}
                onChange={(v) => setCustomer(v ?? "")}
              />
            </FieldLabel>
            <FieldLabel label="Customer Contact Email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="name@customer.com"
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Customer Reference">
            <input
              type="text"
              value={customerReference}
              onChange={(e) => setCustomerReference(e.target.value)}
              placeholder="e.g. Odessa Field Unit B100"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Order Notes">
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              rows={3}
              placeholder="Anything production should know — supports checklists on the detail page"
              className="select resize-y"
              disabled={busy}
            />
          </FieldLabel>

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-muted">
              Starts as <span className="font-semibold">Submitted</span>. You'll be added as a
              watcher.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Creating…" : "Create"}
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
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
