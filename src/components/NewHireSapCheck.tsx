import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { signInToFabric } from "@/api/fabric";
import { useSapEmployees } from "@/hooks/useSapEmployees";
import { checkNewHireInSap, type SapEmployee } from "@/lib/sapEmployees";
import type { NewHire } from "@/types/hr";
import { HrCardTitle } from "./hrAtoms";

// =============================================================================
// "Is this new hire in SAP?" — a card on a New Hire's page. It reads SAP's
// employee list (Fabric, `dbo.tbl_arc_employee`) in the background and says
// what it found; the rule is `checkNewHireInSap` (lib/sapEmployees.ts). It
// writes nothing — "Added to SAP" is still ticked by a person.
// =============================================================================

function who(e: SapEmployee): string {
  return `${e.name || "(no name)"}, employee ${e.employeeNumber || "(no number)"}`;
}

export function NewHireSapCheck({ hire }: { hire: NewHire }) {
  const { employees, loading, failure, signInNeeded, refetch } = useSapEmployees();
  const [signingIn, setSigningIn] = useState(false);

  async function signIn() {
    setSigningIn(true);
    try {
      await signInToFabric();
      await refetch();
    } catch {
      // The card keeps saying why it couldn't check; the popup said the rest.
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 text-sm" data-testid="new-hire-sap-check">
      <HrCardTitle>SAP</HrCardTitle>
      <div className="mt-2">
        {loading ? (
          <Line icon={<Loader2 className="h-4 w-4 animate-spin text-fg-muted" />}>Checking SAP…</Line>
        ) : failure || !employees ? (
          <>
            <Line icon={<CircleDashed className="h-4 w-4 text-fg-muted" />}>
              <span className="text-fg-muted">{failure ?? "Couldn't check SAP."}</span>
            </Line>
            {signInNeeded && (
              <button
                type="button"
                onClick={() => void signIn()}
                disabled={signingIn}
                className="mt-2 rounded-md border border-border px-3 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
              >
                {signingIn ? "Signing in…" : "Sign in to SAP"}
              </button>
            )}
          </>
        ) : (
          <Result hire={hire} employees={employees} />
        )}
      </div>
    </section>
  );
}

function Result({ hire, employees }: { hire: NewHire; employees: SapEmployee[] }) {
  const check = checkNewHireInSap(hire, employees);
  const ok = <CheckCircle2 className="h-4 w-4 text-cooper-green" />;
  const warn = <AlertTriangle className="h-4 w-4 text-ajax-yellow" />;
  const none = <CircleDashed className="h-4 w-4 text-fg-muted" />;

  switch (check.kind) {
    case "confirmed":
      return (
        <>
          <Line icon={ok}>
            <span className="font-medium text-fg">In SAP</span>
            <span className="text-fg-muted"> — {who(check.employee)}.</span>
          </Line>
          {check.by === "name" && !hire.empNumber.trim() && (
            <Note>Found by name. The EMP number isn't recorded on this page yet.</Note>
          )}
          {check.nameDiffers && (
            <Note warn>SAP has this EMP number under a different name — check it's the right person.</Note>
          )}
        </>
      );
    case "number-not-found":
      return (
        <>
          <Line icon={warn}>
            <span className="font-medium text-fg">EMP number {check.empNumber} isn't in SAP.</span>
          </Line>
          {check.byName.length > 0 && (
            <Note>
              SAP has this name as {check.byName.map(who).join("; ")} — check the EMP number.
            </Note>
          )}
        </>
      );
    case "ambiguous":
      return (
        <>
          <Line icon={warn}>
            <span className="font-medium text-fg">{check.candidates.length} people in SAP have this name.</span>
          </Line>
          <Note>
            {check.candidates.map(who).join("; ")}. Record the EMP number to say which.
          </Note>
        </>
      );
    case "not-found":
      return (
        <>
          <Line icon={none}>
            <span className="font-medium text-fg">Not in SAP yet.</span>
          </Line>
          {hire.steps.addedToSap && (
            <Note warn>"Added to SAP" is ticked, but SAP's employee list doesn't show them yet — it may not have caught up.</Note>
          )}
        </>
      );
    case "nothing-to-check":
      return <Note>Add a first and last name, or the EMP number, to check SAP.</Note>;
  }
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Note({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <p className={warn ? "mt-1.5 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2 py-1 text-xs text-fg" : "mt-1.5 text-xs text-fg-muted"}>
      {children}
    </p>
  );
}
