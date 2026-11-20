import type { CrimpMachine, CrimpMachineRef, CrimpSpec } from "@/types/crimp";

// =============================================================================
// Crimp machines — which presses a spec runs on (Tim and the Harness manager,
// 2026-11-12). Pure; the spec form, the check form, both screens and the
// email all ask these.
//
// The machines are rows of the Altronic Equipment List (the CMMS asset
// register), not a list of our own: maintenance already keeps the presses
// there, so a press added, renamed or retired there is right here too.
//
// A spec can name SEVERAL presses (an applicator moves between AMP PRESS #1
// and #2), so a spec is still one per terminal + applicator + gauge.
// =============================================================================

/**
 * Is this asset a crimp machine to OFFER? A press (Equipment Type PRESS) in a
 * Harness location, not retired — Tim's filter — plus the named exceptions
 * below. The register holds two
 * Harness locations ("HARNESS DEPARTMENT" and "HARNESS"), so the location is
 * matched on the word. An asset typed otherwise is offered nowhere, but one a
 * spec already names is still shown (see `crimpMachineOptions`).
 */
export function isCrimpMachine(
  machine: Pick<CrimpMachine, "name" | "equipmentType" | "location" | "retired">,
): boolean {
  if (machine.retired) return false;
  if (CRIMP_MACHINE_EXCEPTIONS.includes(machine.name.trim().toUpperCase())) return true;
  if (machine.equipmentType.trim().toUpperCase() !== "PRESS") return false;
  return /\bHARNESS\b/i.test(machine.location);
}

/**
 * Crimp machines the type rule misses, by asset name (Tim, 2026-11-12). The
 * Schleuniger crimp center SCHCC36S stays typed CUT/STRP in the register —
 * it cuts and strips as well — but it crimps, so it's offered. Offered
 * wherever it sits; still left out once retired. Upper case.
 */
export const CRIMP_MACHINE_EXCEPTIONS: readonly string[] = ["SCHCC36S"];

const byName = (a: CrimpMachineRef, b: CrimpMachineRef) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id - b.id;

/** The crimp machines to offer, by name. */
export function crimpMachines(all: CrimpMachine[]): CrimpMachine[] {
  return all.filter(isCrimpMachine).sort(byName);
}

/**
 * A machine picker's options: every crimp machine, PLUS whatever is already
 * picked even if it no longer passes the filter — a picker that dropped a
 * current value would clear it on the next save (the CMMS reference-list
 * rule). A picked id the register doesn't know keeps a stand-in.
 */
export function crimpMachineOptions(
  all: CrimpMachine[],
  selected: readonly CrimpMachineRef[],
): Array<{ value: string; label: string }> {
  const offered = crimpMachines(all);
  const options = offered.map((m) => ({ value: String(m.id), label: m.name }));
  for (const ref of [...selected].sort(byName)) {
    if (options.some((o) => o.value === String(ref.id))) continue;
    const asset = all.find((m) => m.id === ref.id);
    const why = !asset ? "not in the asset list" : asset.retired ? "retired" : "not a Harness press";
    options.push({ value: String(ref.id), label: `${asset?.name || ref.name || `Asset #${ref.id}`} (${why})` });
  }
  return options;
}

/**
 * Graph → the machines a spec names. A multi lookup comes back as
 * `[{ LookupId, LookupValue }]`; some responses carry only the bare
 * `MachinesLookupId` array (ids as strings), in which case the names are
 * filled in later from the register (`withMachineNames`).
 */
export function parseMachineRefs(raw: unknown, rawIds?: unknown): CrimpMachineRef[] {
  const out: CrimpMachineRef[] = [];
  const add = (id: unknown, name: unknown) => {
    const n = typeof id === "number" ? id : parseInt(String(id ?? ""), 10);
    if (!Number.isInteger(n) || n <= 0 || out.some((r) => r.id === n)) return;
    out.push({ id: n, name: typeof name === "string" ? name : "" });
  };
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)
      ? (raw as { results: unknown[] }).results
      : [];
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      add(o.LookupId ?? o.lookupId, o.LookupValue ?? o.lookupValue);
    }
  }
  if (out.length === 0 && Array.isArray(rawIds)) rawIds.forEach((id) => add(id, ""));
  return out;
}

/** Names from the register where the lookup didn't carry one. Never blank: `Asset #12`. */
export function withMachineNames(refs: CrimpMachineRef[], all: CrimpMachine[]): CrimpMachineRef[] {
  return refs.map((r) => ({
    id: r.id,
    name: all.find((m) => m.id === r.id)?.name || r.name || `Asset #${r.id}`,
  }));
}

/** "AMP PRESS #1, AMP PRESS #2", or "" for none. */
export function machineNames(refs: readonly CrimpMachineRef[]): string {
  return [...refs].sort(byName).map((r) => r.name || `Asset #${r.id}`).join(", ");
}

/**
 * Does this spec belong under this machine in the check form? Yes when it
 * names the machine, and — so the floor isn't stopped while the specs are
 * being assigned — when it names no machine at all.
 */
export function specRunsOn(spec: Pick<CrimpSpec, "machines">, machineId: number | null): "yes" | "unassigned" | "no" {
  if (spec.machines.length === 0) return "unassigned";
  if (machineId === null) return "yes";
  return spec.machines.some((m) => m.id === machineId) ? "yes" : "no";
}
