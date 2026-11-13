import type { CoatingCheck, CoatingReadings, CoatingSpec, CoatingUnit } from "@/types/coating";
import { buildCoatingCheckTitle, coatingSnapshotOf } from "@/lib/coatingCheck";
import { deriveCoatingFigures } from "@/lib/coatingMapper";

// =============================================================================
// Demo data for Conformal Coating Thickness Checks. INVENTED — machine names,
// operators and limits are made up (CLAUDE.md rule 8). Shaped like the real
// thing: a both-sides spec and a one-side spec, an mm spec and an inch spec,
// a retired spec, checks in inches and in millimetres, and one out of spec.
// =============================================================================

export const MOCK_COATING_SPECS: CoatingSpec[] = [
  { id: 1, name: "Acrylic — standard", minMm: 0.025, maxMm: 0.075, specUnit: "mm", coatedSides: 2, notes: "Both faces sprayed.", active: true },
  // Entered in inches (0.002 – 0.008 in), stored in mm.
  { id: 2, name: "Silicone — one side", minMm: 0.0508, maxMm: 0.2032, specUnit: "in", coatedSides: 1, notes: "", active: true },
  { id: 3, name: "Urethane (old line)", minMm: 0.025, maxMm: 0.075, specUnit: "mm", coatedSides: 2, notes: "No longer used.", active: false },
];

/** Hours before now — keeps the demo inside the current year's log most of the year. */
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

function check(
  id: number,
  specId: number,
  hours: number,
  machine: string,
  operator: string,
  unit: CoatingUnit,
  uncoated: CoatingReadings,
  coated: CoatingReadings,
  notes = "",
): CoatingCheck {
  const spec = MOCK_COATING_SPECS.find((s) => s.id === specId)!;
  const snapshot = coatingSnapshotOf(spec);
  const at = hoursAgo(hours);
  return {
    id,
    title: buildCoatingCheckTitle(machine, spec.name, at),
    measuredAt: at,
    machine,
    operator,
    unit,
    ...snapshot,
    uncoated,
    coated,
    ...deriveCoatingFigures({ uncoated, coated, unit, snapshot }),
    notes,
    createdAt: at,
    modifiedAt: at,
  };
}

export const MOCK_COATING_CHECKS: CoatingCheck[] = [
  check(1, 1, 2, "DEMO-SPRAY-1", "Demo Operator", "in", [0.062, 0.0622, 0.0621], [0.0661, 0.0662, 0.066]),
  check(2, 2, 3, "DEMO-SPRAY-2", "Demo Operator", "mm", [1.575, 1.577, 1.576], [1.64, 1.642, 1.641]),
  check(
    3,
    1,
    26,
    "DEMO-SPRAY-1",
    "Demo Second Shift",
    "in",
    [0.0621, 0.0621, 0.0622],
    [0.07, 0.0701, 0.0699],
    "Heavy coat — nozzle checked after.",
  ),
  check(4, 1, 50, "DEMO-SPRAY-1", "Demo Operator", "in", [0.0619, 0.062, 0.0621], [0.0659, 0.066, 0.0658]),
];
