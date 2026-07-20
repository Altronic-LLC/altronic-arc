import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { useBuildRequests, useCreateBuildRequest } from "@/hooks/useBuildRequests";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  BUILD_REQUEST_LEAD_TIMES,
  BUILD_REQUEST_SAMPLE_PHASES,
  BUILD_REQUEST_TYPES,
  type BuildRequestLeadTime,
  type BuildRequestSamplePhase,
  type BuildRequestType,
  type Person,
} from "@/types/task";
import { nextBuildRequestNo } from "@/lib/buildRequestNumber";
import { MultiSelect, SingleSelect } from "./SearchableSelect";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";

interface BuildRequestFormModalProps {
  onClose: () => void;
}

/**
 * Create modal for Build Request headers. Parts are added afterwards from
 * the detail page ("Add Part"), matching how the old Power Apps dashboard
 * worked (header first, then parts). BR No is computed client-side from the
 * loaded list (nextBuildRequestNo) — same convention as EIR numbers.
 */
export function BuildRequestFormModal({ onClose }: BuildRequestFormModalProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: allBrs = [] } = useBuildRequests();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const createBr = useCreateBuildRequest();
  const directory = useDirectoryPeople();

  const [title, setTitle] = useState("");
  const [brType, setBrType] = useState<BuildRequestType | "">("");
  const [leadTime, setLeadTime] = useState<BuildRequestLeadTime | "">("STD Lead Time");
  const [shipDate, setShipDate] = useState("");
  const [samplePhase, setSamplePhase] = useState<BuildRequestSamplePhase | "">("");
  const [engineerKey, setEngineerKey] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPO, setCustomerPO] = useState("");
  const [leadFree, setLeadFree] = useState(false);
  const [projectIds, setProjectIds] = useState<number[]>([]);
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
  // across Engineering tasks (same pool the task pickers use).
  const allPeople: Person[] = (() => {
    const seen = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
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
      setError("Product or project name is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const engineer = engineerKey
        ? allPeople.find((p) => (p.email ?? p.displayName) === engineerKey) ?? null
        : null;
      const created = await createBr.mutateAsync({
        title: trimmedTitle,
        brNo: nextBuildRequestNo(allBrs),
        brType: brType || null,
        requiredLeadTime: leadTime || null,
        quotedShipDate: leadTime === "Ship Date" && shipDate ? new Date(shipDate) : null,
        samplePhase: brType === "Sample (A-D)" && samplePhase ? samplePhase : null,
        requestor: currentUser,
        engineerAssigned: engineer,
        customerName: customerName.trim() || undefined,
        customerPO: customerPO.trim() || undefined,
        leadFree,
        parentProjectLookupIds: projectIds,
        watchers: [currentUser],
      });
      onClose();
      navigate(`/build-request/${created.id}`);
    } catch {
      setError("Couldn't create the build request — please retry.");
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
            <Plus className="h-4 w-4 text-accent" /> New Build Request
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
          <FieldLabel label="Product or Project Name *">
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. HUB V4"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Type">
              <select
                value={brType}
                onChange={(e) => setBrType(e.target.value as BuildRequestType | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {BUILD_REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Required Lead Time">
              <select
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value as BuildRequestLeadTime | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {BUILD_REQUEST_LEAD_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </div>

          {leadTime === "Ship Date" && (
            <FieldLabel label="Quoted Ship Date">
              <input
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          )}

          {brType === "Sample (A-D)" && (
            <FieldLabel label="Sample Phase">
              <select
                value={samplePhase}
                onChange={(e) => setSamplePhase(e.target.value as BuildRequestSamplePhase | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {BUILD_REQUEST_SAMPLE_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </FieldLabel>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            <FieldLabel label="Project Reference">
              <MultiSelect
                allLabel="No projects"
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
                selected={projectIds.map(String)}
                onChange={(next) =>
                  setProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
                }
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Customer Name">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Customer PO">
              <input
                type="text"
                value={customerPO}
                onChange={(e) => setCustomerPO(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={leadFree}
              onChange={(e) => setLeadFree(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-border"
            />
            Lead Free (RoHS)
          </label>

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-muted">
              Will be numbered <span className="font-mono font-semibold">{nextBuildRequestNo(allBrs)}</span>
              . Add parts from the detail page after creating.
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
