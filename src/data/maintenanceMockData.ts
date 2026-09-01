import type {
  Equipment,
  MaintenanceReferenceValue,
  MaintenanceTask,
  Person,
  ProjectReference,
  ScheduledMaintenance,
} from "@/types/task";
import { EQUIPMENT_DEPARTMENTS, EQUIPMENT_LOCATIONS } from "@/types/task";
import { MOCK_OPERATIONS_PROJECTS } from "./operationsMockData";

// =============================================================================
// Mock data for the CMMS module — work orders, PM schedules and the equipment
// register they both point at. Used when VITE_USE_MOCK=true.
//
// **Every date is relative to today**, not a fixed calendar date. A demo whose
// PM calendar is two years stale looks broken in a way that has nothing to do
// with the code, and the whole point of a maintenance module is that it shows
// what is due now. `day(-3)` is three days ago, `day(10)` is ten days out.
//
// Asset names come from the live Altronic Equipment List sample rows
// (scripts/altronic-equipment-list-schema.json) — TM1, 20 HP COMPRESSOR and
// friends are real machines — plus plausible neighbours from the same shop.
// The first five lookupIds match `MOCK_OPERATIONS_EQUIPMENT` in
// operationsMockData.ts, so an Operations task and a work order that name the
// same asset agree about which one it is.
// =============================================================================

/** Midday UTC, `offset` days from today — the storage convention for date-only columns. */
function day(offset: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 12, 0, 0),
  );
}

/** A timestamp `offset` days ago, for created/modified stamps. */
function stamp(offset: number): Date {
  return new Date(day(offset).getTime() + 3 * 3600_000);
}

/**
 * A checklist attribution stamp, `offset` days ago — the exact shape
 * `toggleChecklistItem` writes when somebody ticks a box
 * (`✓[Ray White · 7/17/2026, 10:15 AM]`), including the same deterministic
 * en-US format `formatStampDate` uses.
 *
 * Built from a relative date like every other date in this file, so a demo
 * ticked "yesterday" still reads as yesterday next month. Hardcoding one
 * would go stale exactly the way a fixed PM calendar does.
 */
function tickedBy(name: string, offset: number): string {
  const when = new Date(day(offset).getTime() + 9 * 3600_000);
  return ` ✓[${name} · ${when.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}]`;
}

const RAY: Person = {
  displayName: "Ray White",
  email: "ray.white@altronic-llc.com",
  lookupId: 22,
};
const DAVID: Person = {
  displayName: "David Bulkley",
  email: "david.bulkley@altronic-llc.com",
  lookupId: 24,
};
const ALYSSA: Person = {
  displayName: "Alyssa Garrett",
  email: "alyssa.garrett@altronic-llc.com",
  lookupId: 63,
};
const ERIC: Person = {
  displayName: "Eric Gilkinson",
  email: "eric.gilkinson@altronic-llc.com",
  lookupId: 65,
};
const AMANDA: Person = {
  displayName: "Amanda Hoagland",
  email: "amanda.hoagland@altronic-llc.com",
  lookupId: 25,
};
const DEMO: Person = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 999,
};

export const MOCK_MAINTENANCE_PEOPLE: Person[] = [RAY, DAVID, ALYSSA, ERIC, AMANDA, DEMO];

// -----------------------------------------------------------------------------
// Reference lists — Maintenance Departments and Maintenance Locations
//
// Seeded from the REAL values the two lookup lists were created with on
// 2026-08-28, which are exactly the values the old CHOICE columns held
// (EQUIPMENT_DEPARTMENTS / EQUIPMENT_LOCATIONS in types/task.ts). The junk
// travels with them on purpose: a literal `-`, "Q.C." beside "QC", "Q.C.
// DIGITAL" beside "QC DIGITAL", "HARNESS DEPARMENT" beside "HARNESS
// DEPARTMENT". The admin screen's duplicate hint has nothing to point at in a
// demo whose data has been tidied — and tidying it here would make the mock
// disagree with the list people actually open.
// -----------------------------------------------------------------------------

/**
 * One location is seeded RETIRED — the "HARNESS DEPARMENT" typo, whose
 * correctly-spelled twin is the one assets point at. It is what makes the
 * "active values only in the picker, but a retired value still displays"
 * rule demoable without breaking a single asset.
 */
const RETIRED_MOCK_LOCATIONS = new Set(["HARNESS DEPARMENT"]);

function seedReferenceList(
  titles: readonly string[],
  retired: ReadonlySet<string> = new Set(),
): MaintenanceReferenceValue[] {
  return titles.map((title, i) => ({
    lookupId: i + 1,
    title,
    active: !retired.has(title),
    note: "",
  }));
}

export const MOCK_MAINTENANCE_DEPARTMENTS: MaintenanceReferenceValue[] =
  seedReferenceList(EQUIPMENT_DEPARTMENTS);

export const MOCK_MAINTENANCE_LOCATIONS: MaintenanceReferenceValue[] = seedReferenceList(
  EQUIPMENT_LOCATIONS,
  RETIRED_MOCK_LOCATIONS,
);

/**
 * A seed's department / location NAME, as the `{ lookupId, title }` reference
 * the domain now holds.
 *
 * The seeds still name their department in words, because that is how a person
 * reading this file knows which machine is where. An unknown name is a bug in
 * the seed rather than a case to handle quietly, so it throws — the mock and
 * the mock reference lists have to agree, or the demo shows dangling lookups
 * that the real data would never produce.
 */
function referenceByTitle(
  values: MaintenanceReferenceValue[],
  title: string | null | undefined,
  kind: string,
): ProjectReference | null {
  if (!title) return null;
  const found = values.find((v) => v.title === title);
  if (!found) throw new Error(`Mock seed names a ${kind} that isn't on the mock list: "${title}"`);
  return { lookupId: found.lookupId, title: found.title };
}

const departmentRef = (title: string | null | undefined) =>
  referenceByTitle(MOCK_MAINTENANCE_DEPARTMENTS, title, "department");
const locationRef = (title: string | null | undefined) =>
  referenceByTitle(MOCK_MAINTENANCE_LOCATIONS, title, "location");

// -----------------------------------------------------------------------------
// Equipment register
// -----------------------------------------------------------------------------

interface AssetSeed {
  lookupId: number;
  name: string;
  description: string;
  serialNo: string;
  equipmentType: string;
  /** Optional so a seed can be genuinely MISSING one — see `assetTag` below. */
  department?: string;
  location?: string;
  criticality?: string;
  assetStatus: string;
  manufacturer: string;
  modelNumber: string;
  parentLookupId?: number;
  installedDaysAgo: number;
  warrantyDays?: number;
  responsibleTech: Person | null;
  /**
   * `AssetTag` / `CurrentMachineHours` — **left off most seeds on purpose.**
   *
   * The live register is sparse in exactly this way (roughly half the rows
   * have no department, and tags, criticality and meter readings are largely
   * blank), and the asset register screen exists to surface that. A demo where
   * every field is filled in would hide the one thing the screen was built to
   * show, so the mock is deliberately patchy too.
   */
  assetTag?: string;
  machineHours?: number;
  /** Days ago the row was last edited. Drives the register's "Updated" column. */
  editedDaysAgo?: number;
}

const ASSET_SEEDS: AssetSeed[] = [
  {
    lookupId: 1,
    name: "TM1",
    description: "CASCADE SHIDSHIFTER",
    serialNo: "5A535020",
    assetTag: "TM-001",
    machineHours: 4820,
    editedDaysAgo: 3,
    equipmentType: "TOWMOTOR",
    department: "PROD",
    location: "PLANT WIDE",
    criticality: "Important",
    assetStatus: "In Service",
    manufacturer: "Cascade",
    modelNumber: "SS-4000",
    installedDaysAgo: 2400,
    responsibleTech: DAVID,
  },
  {
    lookupId: 2,
    name: "20 HP COMPRESSOR",
    description: "INGERSOLL RAND 20HP ROTARY SCREW",
    serialNo: "J3855U91F",
    assetTag: "AC-020",
    machineHours: 18240,
    editedDaysAgo: 6,
    equipmentType: "AIRCOMP",
    department: "MACH SHOP",
    location: "PANELS",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Ingersoll Rand",
    modelNumber: "R20i",
    installedDaysAgo: 1800,
    warrantyDays: 120,
    responsibleTech: DAVID,
  },
  {
    lookupId: 3,
    name: "40 HP COMPRESSOR",
    description: "INGERSOLL RAND 40HP ROTARY SCREW",
    serialNo: "K7712U04A",
    assetTag: "AC-040",
    editedDaysAgo: 210,
    equipmentType: "AIRCOMP",
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Ingersoll Rand",
    modelNumber: "R40i",
    installedDaysAgo: 1500,
    warrantyDays: -60,
    responsibleTech: DAVID,
  },
  {
    lookupId: 4,
    name: "50 HP COMPRESSOR",
    description: "STANDBY ROTARY SCREW COMPRESSOR",
    serialNo: "K9920U18C",
    machineHours: 940,
    editedDaysAgo: 45,
    equipmentType: "AIRCOMP",
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
    criticality: "Important",
    assetStatus: "Standby",
    manufacturer: "Ingersoll Rand",
    modelNumber: "R50i",
    installedDaysAgo: 900,
    responsibleTech: DAVID,
  },
  {
    lookupId: 5,
    name: "5000 DIGITAL",
    description: "DIGITAL IGNITION TEST STAND",
    serialNo: "TS-5000-11",
    assetTag: "TS-500",
    editedDaysAgo: 12,
    equipmentType: "TST STND",
    department: "QC",
    location: "QUALITY TEST LAB",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Altronic",
    modelNumber: "DISN-5000",
    installedDaysAgo: 1200,
    responsibleTech: ERIC,
  },
  {
    lookupId: 6,
    name: "AIR DRYER - MAIN",
    description: "REFRIGERATED AIR DRYER, MAIN HEADER",
    serialNo: "AD-88213",
    machineHours: 26110,
    editedDaysAgo: 9,
    equipmentType: "AIRDRYER",
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
    criticality: "Important",
    assetStatus: "In Service",
    manufacturer: "Ingersoll Rand",
    modelNumber: "D340IN",
    parentLookupId: 3,
    installedDaysAgo: 1500,
    responsibleTech: DAVID,
  },
  {
    lookupId: 7,
    name: "PVA CONFORMAL COATER",
    description: "PVA SELECTIVE CONFORMAL COATING SYSTEM",
    serialNo: "PVA-2024-77",
    assetTag: "PCB-007",
    machineHours: 1180,
    editedDaysAgo: 2,
    equipmentType: "CONFCOAT",
    department: "PCB",
    location: "DIP ROOM",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "PVA",
    modelNumber: "Delta 6",
    installedDaysAgo: 420,
    warrantyDays: 40,
    responsibleTech: ERIC,
  },
  {
    lookupId: 8,
    name: "REFLOW OVEN #2",
    description: "10-ZONE SMT REFLOW OVEN",
    serialNo: "HL-1091-02",
    machineHours: 33900,
    editedDaysAgo: 18,
    equipmentType: "OVEN",
    department: "SMT",
    location: "SURFACE MOUNT AREA",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Heller",
    modelNumber: "1913 MK5",
    installedDaysAgo: 2100,
    responsibleTech: ALYSSA,
  },
  {
    lookupId: 9,
    name: "COIL WINDER #4",
    description: "AUTOMATIC STATOR COIL WINDER",
    serialNo: "CW-4408",
    assetTag: "CL-004",
    // A genuine ZERO, and the only one in the register. Zero is a real reading
    // off a machine that hasn't run yet, and the whole meter path depends on it
    // behaving differently from `null` ("never recorded") — so the demo carries
    // one of each rather than leaving the distinction untested by eye.
    machineHours: 0,
    editedDaysAgo: 1,
    equipmentType: "COILWIND",
    department: "COILS",
    location: "COIL DEPARTMENT",
    criticality: "Important",
    assetStatus: "Down",
    manufacturer: "Marsilli",
    modelNumber: "MC-204",
    installedDaysAgo: 2600,
    responsibleTech: AMANDA,
  },
  {
    lookupId: 10,
    name: "KITAMURA VMC",
    description: "VERTICAL MACHINING CENTRE",
    serialNo: "KIT-3XD-0912",
    assetTag: "MS-010",
    machineHours: 41200,
    editedDaysAgo: 27,
    equipmentType: "VMC",
    department: "MACH SHOP",
    location: "MACHINE SHOP @ KITAMURA",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Kitamura",
    modelNumber: "Mycenter-3XD",
    installedDaysAgo: 3300,
    responsibleTech: DAVID,
  },
  {
    lookupId: 11,
    name: "FADAL 6030",
    description: "FADAL VERTICAL MILL",
    serialNo: "FAD-6030-441",
    editedDaysAgo: 400,
    equipmentType: "MILLMACH",
    location: "FADAL 6030",
    criticality: "Important",
    assetStatus: "In Service",
    manufacturer: "Fadal",
    modelNumber: "VMC 6030",
    installedDaysAgo: 4200,
    responsibleTech: DAVID,
  },
  {
    lookupId: 12,
    name: "POTTING OVEN",
    description: "CURING OVEN, POTTING ROOM",
    serialNo: "PO-2277",
    machineHours: 15600,
    editedDaysAgo: 33,
    equipmentType: "POTTING",
    department: "COILS",
    location: "POTTING ROOM",
    criticality: "Important",
    assetStatus: "In Service",
    manufacturer: "Grieve",
    modelNumber: "AB-550",
    installedDaysAgo: 2800,
    responsibleTech: AMANDA,
  },
  {
    lookupId: 13,
    name: "CMM - ZEISS",
    description: "COORDINATE MEASURING MACHINE",
    serialNo: "ZS-CTX-0084",
    assetTag: "QC-013",
    editedDaysAgo: 60,
    equipmentType: "CMM",
    department: "QC",
    location: "CMM ROOM @ BACK OF MACHINE",
    criticality: "Critical",
    assetStatus: "In Service",
    manufacturer: "Zeiss",
    modelNumber: "Contura G2",
    installedDaysAgo: 1900,
    warrantyDays: 220,
    responsibleTech: ERIC,
  },
  {
    lookupId: 14,
    name: "HARNESS CUT/STRIP",
    description: "AUTOMATIC WIRE CUT AND STRIP MACHINE",
    serialNo: "KOM-355-19",
    editedDaysAgo: 150,
    equipmentType: "CUT/STRP",
    location: "HARNESS DEPARTMENT",
    assetStatus: "In Service",
    manufacturer: "Komax",
    modelNumber: "Kappa 330",
    installedDaysAgo: 1100,
    responsibleTech: ALYSSA,
  },
  {
    lookupId: 15,
    name: "OLD VAPOUR DEGREASER",
    description: "RETIRED VAPOUR DEGREASING UNIT",
    serialNo: "VD-0001",
    editedDaysAgo: 900,
    equipmentType: "VAPDEGRE",
    department: "PROD",
    location: "REAR STORAGE AREA",
    criticality: "Standard",
    assetStatus: "Retired",
    manufacturer: "Baron Blakeslee",
    modelNumber: "MLR-12",
    installedDaysAgo: 6000,
    responsibleTech: null,
  },
];

const ASSET_NAMES = new Map(ASSET_SEEDS.map((a) => [a.lookupId, a.name]));

export const MOCK_EQUIPMENT: Equipment[] = ASSET_SEEDS.map((a) => ({
  lookupId: a.lookupId,
  name: a.name,
  description: a.description,
  serialNo: a.serialNo,
  manufacturer: a.manufacturer,
  modelNumber: a.modelNumber,
  equipmentType: a.equipmentType,
  department: departmentRef(a.department),
  location: locationRef(a.location),
  criticality: a.criticality ?? null,
  assetStatus: a.assetStatus,
  parentAsset: a.parentLookupId
    ? { lookupId: a.parentLookupId, title: ASSET_NAMES.get(a.parentLookupId) ?? "" }
    : null,
  installDate: day(-a.installedDaysAgo),
  warrantyExpiry: a.warrantyDays === undefined ? null : day(a.warrantyDays),
  responsibleTech: a.responsibleTech,
  assetTag: a.assetTag ?? "",
  // `null`, never 0 — a machine sitting at zero hours has been read; one that
  // has never been read has not, and only the second needs somebody to act.
  currentMachineHours: a.machineHours ?? null,
  modifiedAt: day(-(a.editedDaysAgo ?? 30)),
  hasAttachments: false,
}));

const assetRef = (lookupId: number): ProjectReference => ({
  lookupId,
  title: ASSET_NAMES.get(lookupId) ?? `Asset #${lookupId}`,
});

// -----------------------------------------------------------------------------
// PM schedules — a mix of Fixed and Floating, one inactive, one overdue.
// -----------------------------------------------------------------------------

interface ScheduleSeed
  extends Partial<
    Omit<
      ScheduledMaintenance,
      "id" | "equipment" | "operationsProject" | "department" | "location" | "createdAt" | "modifiedAt"
    >
  > {
  id: number;
  title: string;
  /**
   * Optional so a seed can genuinely have NO asset — a meter schedule with no
   * equipment link can never be evaluated, and that fault has to be
   * representable here or the screen that reports it has nothing to show.
   */
  equipmentLookupId?: number;
  /** Named in words; resolved to a reference-list lookup below. */
  department?: string;
  location?: string;
  /** Operations Projects lookupId — resolved to a titled reference below. */
  operationsProjectLookupId?: number;
  createdDaysAgo: number;
}

/**
 * An Operations Projects reference, titled from the Operations module's own
 * demo data — so a work order and an Operations task naming project 3 agree
 * about which one it is, exactly as they already do for equipment.
 */
const operationsProjectRef = (id: number): ProjectReference =>
  MOCK_OPERATIONS_PROJECTS.find((p) => p.lookupId === id) ?? {
    lookupId: id,
    title: `(project #${id})`,
  };

const SCHEDULE_SEEDS: ScheduleSeed[] = [
  {
    id: 1,
    title: "Weekly compressor walkaround",
    equipmentLookupId: 2,
    instructions:
      "Check oil level, drain the receiver, listen for leaks, log the discharge pressure.",
    category: "Inspection",
    priority: "Med",
    frequencyInterval: 1,
    frequencyUnit: "Weeks",
    scheduleBasis: "Fixed",
    firstDueDate: day(-56),
    nextDueDate: day(2),
    lastCompleted: day(-5),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 1,
    graceDays: 2,
    leadTimeDays: 3,
    createdDaysAgo: 200,
    department: "MACH SHOP",
    location: "PANELS",
  },
  {
    id: 2,
    title: "40 HP compressor oil change",
    equipmentLookupId: 3,
    instructions: [
      "Shutdown and lock-out required — do not start this until the unit is isolated.",
      "- [ ] Isolate at the disconnect and apply your lock and tag",
      "- [ ] Bleed the receiver to zero and confirm at the gauge",
      "- [ ] Let the unit cool — the sump runs hot straight after a stop",
      "- [ ] Drain the sump into the waste oil drum",
      "- [ ] Replace the oil filter",
      "- [ ] Replace the separator element and its gasket",
      "- [ ] Refill to the sight-glass mark and log the quantity",
      "- [ ] Remove locks, restore power and run up",
      "- [ ] Check for leaks and confirm discharge pressure holds",
      "Log the oil quantity on the work order — it is what the next interval is set from.",
    ].join("\n"),
    category: "Oil Change",
    priority: "High",
    frequencyInterval: 90,
    frequencyUnit: "Days",
    scheduleBasis: "Floating",
    firstDueDate: day(-270),
    nextDueDate: day(8),
    lastCompleted: day(-82),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 3,
    graceDays: 7,
    leadTimeDays: 14,
    requiresShutdown: true,
    lotoRequired: true,
    createdDaysAgo: 300,
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
    operationsProjectLookupId: 4,
  },
  {
    id: 3,
    title: "Reflow oven profile verification",
    equipmentLookupId: 8,
    instructions: [
      "- [ ] Fit the profiling board and confirm the thermocouples read ambient",
      "- [ ] Run the board through all ten zones at production belt speed",
      "\t- [ ] Check each zone against its set point on the trace",
      "\t- [ ] Flag any zone more than 5C out and note the zone number",
      "\t- [ ] Re-run the board after any adjustment",
      "- [ ] Print the trace and file it with QC",
      "- [ ] Record the peak temperature and time above liquidus on the work order",
      "QC keeps the trace for the audit — the run is not finished until it is filed.",
    ].join("\n"),
    category: "Calibration",
    priority: "High",
    frequencyInterval: 1,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: day(-180),
    // Overdue and NOT rolled forward — it stays here until somebody does it.
    nextDueDate: day(-11),
    lastCompleted: day(-41),
    lastCompletedBy: ALYSSA,
    assignedTo: ALYSSA,
    timeNeeded: 2,
    graceDays: 3,
    leadTimeDays: 7,
    createdDaysAgo: 400,
  },
  {
    id: 4,
    title: "CMM annual calibration",
    equipmentLookupId: 13,
    instructions: "Vendor calibration visit. Certificate goes in the QC binder and on the asset.",
    category: "Calibration",
    priority: "High",
    frequencyInterval: 1,
    frequencyUnit: "Years",
    scheduleBasis: "Fixed",
    firstDueDate: day(-700),
    nextDueDate: day(35),
    lastCompleted: day(-330),
    lastCompletedBy: ERIC,
    assignedTo: ERIC,
    timeNeeded: 8,
    graceDays: 14,
    leadTimeDays: 45,
    requiresShutdown: true,
    createdDaysAgo: 720,
  },
  {
    id: 5,
    title: "Conformal coater nozzle clean",
    equipmentLookupId: 7,
    instructions: "Purge and clean the applicator nozzles. Replace the filter if flow is uneven.",
    category: "Cleaning",
    priority: "Med",
    frequencyInterval: 2,
    frequencyUnit: "Weeks",
    scheduleBasis: "Floating",
    firstDueDate: day(-120),
    nextDueDate: day(4),
    lastCompleted: day(-10),
    lastCompletedBy: ERIC,
    assignedTo: ERIC,
    timeNeeded: 2,
    graceDays: 3,
    leadTimeDays: 5,
    createdDaysAgo: 150,
  },
  {
    id: 6,
    title: "Kitamura way lube and coolant check",
    equipmentLookupId: 10,
    instructions: [
      "- [ ] Top up the way lube reservoir",
      "- [ ] Check the coolant concentration with the refractometer",
      "- [ ] Skim the tramp oil off the tank",
      "- [ ] Log the reading on the work order",
      "Concentration should read 7-9%. Below 6% and the coolant goes off inside a week.",
    ].join("\n"),
    category: "Preventive",
    priority: "Med",
    frequencyInterval: 2,
    frequencyUnit: "Weeks",
    scheduleBasis: "Fixed",
    firstDueDate: day(-140),
    nextDueDate: day(1),
    lastCompleted: day(-13),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 1,
    graceDays: 2,
    leadTimeDays: 3,
    createdDaysAgo: 160,
  },
  {
    id: 7,
    title: "Towmotor safety inspection",
    equipmentLookupId: 1,
    instructions: [
      "- [ ] Forks — check for cracks, wear and a bent tip",
      "- [ ] Mast chains — tension even, no stretched or seized links",
      "- [ ] Horn sounds",
      "- [ ] Lights and beacon work",
      "- [ ] Service brake and parking brake hold on the ramp",
      "- [ ] Tyres and wheel nuts",
      "- [ ] Seat belt latches and retracts",
      "Tag out immediately if anything fails — do not leave it for the next shift.",
    ].join("\n"),
    category: "Safety",
    priority: "High",
    frequencyInterval: 1,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: day(-365),
    nextDueDate: day(19),
    lastCompleted: day(-11),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 1,
    graceDays: 0,
    leadTimeDays: 7,
    createdDaysAgo: 380,
  },
  {
    id: 8,
    title: "Potting oven temperature verification",
    equipmentLookupId: 12,
    instructions: "Verify set point against the reference probe at 150C. Record the deviation.",
    category: "Calibration",
    priority: "Med",
    frequencyInterval: 6,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: day(-400),
    nextDueDate: day(72),
    lastCompleted: day(-110),
    lastCompletedBy: AMANDA,
    assignedTo: AMANDA,
    timeNeeded: 3,
    graceDays: 10,
    leadTimeDays: 21,
    createdDaysAgo: 420,
  },
  {
    id: 9,
    title: "Cut/strip blade replacement",
    equipmentLookupId: 14,
    instructions: "Replace the cutting and stripping blades. Re-run the first-article sample.",
    category: "Preventive",
    priority: "Low",
    frequencyInterval: 3,
    frequencyUnit: "Months",
    scheduleBasis: "Floating",
    firstDueDate: day(-200),
    nextDueDate: day(26),
    lastCompleted: day(-64),
    lastCompletedBy: ALYSSA,
    assignedTo: ALYSSA,
    timeNeeded: 2,
    graceDays: 5,
    leadTimeDays: 10,
    createdDaysAgo: 240,
  },
  {
    id: 10,
    title: "Vapour degreaser solvent change (retired)",
    equipmentLookupId: 15,
    instructions: "Superseded — the unit was retired. Kept for the history, not for the calendar.",
    category: "Preventive",
    priority: "Low",
    frequencyInterval: 6,
    frequencyUnit: "Months",
    scheduleBasis: "Fixed",
    firstDueDate: day(-1200),
    nextDueDate: day(-430),
    lastCompleted: day(-610),
    lastCompletedBy: DAVID,
    assignedTo: null,
    timeNeeded: 4,
    graceDays: 14,
    leadTimeDays: 30,
    // Inactive: it projects nothing at all, whatever its dates say.
    active: false,
    createdDaysAgo: 1250,
  },

  // ---------------------------------------------------------------------------
  // RUN-HOURS (Hourmeter) schedules.
  //
  // Deliberately one per state the meter path can be in, because the states
  // that matter are the ones where nothing is due and nothing looks wrong:
  //
  //   11  due          — asset 1 reads 4,820, due at 4,800
  //   12  not due      — asset 2 reads 18,240, due at 18,800
  //   13  can't tell   — asset 3 has NO hourmeter reading (the silent failure)
  //   14  can't tell   — no asset linked at all
  //   15  stale        — asset 4 is not due, but its row is 45 days old
  //   16  zero reading — asset 9 reads a genuine 0, NOT the same as null
  //   17  retired      — projects nothing, whatever its reading says
  //
  // The readings come from the asset seeds above (`machineHours` /
  // `editedDaysAgo`), so the demo's numbers agree with the register's.
  // ---------------------------------------------------------------------------
  {
    id: 11,
    title: "Engine oil + filter change (every 500 run hours)",
    equipmentLookupId: 1,
    instructions: [
      "- [ ] Read and note the hourmeter before you start",
      "- [ ] Drain the sump while warm",
      "- [ ] Replace the oil filter",
      "- [ ] Refill to the mark and run up",
    ].join("\n"),
    category: "Oil Change",
    priority: "High",
    frequencyInterval: 500,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    // Last done at 4,300, so due at 4,800 — asset 1 reads 4,820, i.e. 20 run
    // hours past due.
    lastCompletedHours: 4300,
    lastCompleted: day(-40),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 2,
    createdDaysAgo: 300,
  },
  {
    id: 12,
    title: "Compressor valve inspection (every 1,000 run hours)",
    equipmentLookupId: 2,
    instructions: "Pull the valve covers, check seat wear, log the readings.",
    category: "Inspection",
    priority: "Med",
    frequencyInterval: 1000,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    // Due at 18,800; the asset reads 18,240, so 560 run hours to go.
    lastCompletedHours: 17800,
    lastCompleted: day(-90),
    lastCompletedBy: DAVID,
    assignedTo: DAVID,
    timeNeeded: 4,
    createdDaysAgo: 400,
  },
  {
    id: 13,
    // Asset 3 has no `machineHours`, so this one reports "can't tell" rather
    // than sitting quietly in the not-due pile. This is the case the whole
    // feature is built around.
    title: "Gearbox oil sample (every 750 run hours)",
    equipmentLookupId: 3,
    instructions: "Draw a sample from the drain port and send it off.",
    category: "Preventive",
    priority: "Med",
    frequencyInterval: 750,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    nextDueHours: 3000,
    assignedTo: DAVID,
    timeNeeded: 1,
    createdDaysAgo: 120,
  },
  {
    id: 14,
    // No equipment reference at all — it can never be evaluated, and the PM
    // library says so on the row rather than showing a blank.
    title: "Chiller compressor rebuild (every 8,000 run hours)",
    instructions: "Full rebuild — planned against run hours, not the calendar.",
    category: "Preventive",
    priority: "Low",
    frequencyInterval: 8000,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    timeNeeded: 16,
    createdDaysAgo: 60,
  },
  {
    id: 15,
    // Asset 5's row hasn't been edited in a long time, so "not due" is not
    // evidence of much — the library flags the reading as possibly stale.
    title: "Hydraulic filter change (every 250 run hours)",
    equipmentLookupId: 4,
    instructions: "Swap the return-line filter and reset the indicator.",
    category: "Preventive",
    priority: "Med",
    frequencyInterval: 250,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    // Due at 1,050; the asset reads 940 — so "not due", except the asset row
    // has not been edited in 45 days and a whole 250-hour interval takes 11 at
    // the very fastest. "Not due" is not evidence of much here.
    lastCompletedHours: 800,
    lastCompleted: day(-200),
    lastCompletedBy: DAVID,
    timeNeeded: 1,
    createdDaysAgo: 500,
  },
  {
    id: 16,
    // A brand-new machine at a genuine ZERO hours. Zero is a real reading and
    // must not behave like a blank one: this is due at 100 and not due yet.
    title: "Run-in check (first 100 run hours)",
    equipmentLookupId: 9,
    instructions: "First-hours check on a new unit — retorque, check oil, log it.",
    category: "Inspection",
    priority: "High",
    frequencyInterval: 100,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    lastCompletedHours: 0,
    timeNeeded: 1,
    createdDaysAgo: 10,
  },
  {
    id: 17,
    title: "Blower bearing regrease (every 2,000 run hours, retired)",
    equipmentLookupId: 1,
    instructions: "Superseded by the sealed-bearing conversion. Kept for history.",
    category: "Preventive",
    priority: "Low",
    frequencyInterval: 2000,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    lastCompletedHours: 1000,
    // Retired: `meterStatus` reports `applies: false`, so no fault is shown
    // for it however blank its asset's reading is.
    active: false,
    createdDaysAgo: 900,
  },
];

export const MOCK_SCHEDULED_MAINTENANCE: ScheduledMaintenance[] = SCHEDULE_SEEDS.map((s) => ({
  id: s.id,
  title: s.title,
  instructions: s.instructions ?? "",
  category: s.category ?? null,
  priority: s.priority ?? null,
  equipment: s.equipmentLookupId ? assetRef(s.equipmentLookupId) : null,
  operationsProject: s.operationsProjectLookupId
    ? operationsProjectRef(s.operationsProjectLookupId)
    : null,
  department: departmentRef(s.department),
  location: locationRef(s.location),
  frequencyInterval: s.frequencyInterval ?? null,
  frequencyUnit: s.frequencyUnit ?? null,
  scheduleBasis: s.scheduleBasis ?? "Fixed",
  firstDueDate: s.firstDueDate ?? null,
  nextDueDate: s.nextDueDate ?? null,
  lastCompleted: s.lastCompleted ?? null,
  // Run-hours schedules only. `?? null` and not a truthiness check: 0 is a
  // real hourmeter reading off a new machine.
  lastCompletedHours: s.lastCompletedHours ?? null,
  nextDueHours: s.nextDueHours ?? null,
  assignedTo: s.assignedTo ?? null,
  lastCompletedBy: s.lastCompletedBy ?? null,
  watchers: s.watchers ?? [s.assignedTo, RAY].filter((p): p is Person => !!p),
  timeNeeded: s.timeNeeded ?? null,
  graceDays: s.graceDays ?? 0,
  leadTimeDays: s.leadTimeDays ?? 0,
  active: s.active ?? true,
  requiresShutdown: s.requiresShutdown ?? false,
  lotoRequired: s.lotoRequired ?? false,
  hasAttachments: false,
  createdAt: stamp(-s.createdDaysAgo),
  modifiedAt: stamp(-Math.min(s.createdDaysAgo, 14)),
}));

const SCHEDULE_TITLES = new Map(MOCK_SCHEDULED_MAINTENANCE.map((s) => [s.id, s.title]));

const scheduleRef = (id: number): ProjectReference => ({
  lookupId: id,
  title: SCHEDULE_TITLES.get(id) ?? `Schedule #${id}`,
});

// -----------------------------------------------------------------------------
// Work orders — 25 across every status, priority and category, a few overdue,
// several completed with real labour/downtime figures and a failure cause.
// -----------------------------------------------------------------------------

interface WorkOrderSeed
  extends Partial<
    Omit<
      MaintenanceTask,
      | "id"
      | "equipment"
      | "scheduleRef"
      | "operationsProject"
      | "department"
      | "location"
      | "createdAt"
      | "modifiedAt"
      | "taskType"
    >
  > {
  id: number;
  title: string;
  equipmentLookupId: number | null;
  /** Named in words; resolved to a reference-list lookup below. */
  department?: string;
  location?: string;
  scheduleLookupId?: number;
  /** Operations Projects lookupId — resolved to a titled reference below. */
  operationsProjectLookupId?: number;
  createdDaysAgo: number;
}

const YEAR = new Date().getFullYear();
const wo = (n: number) => `WO-${YEAR}-${String(n).padStart(4, "0")}`;

const WORK_ORDER_SEEDS: WorkOrderSeed[] = [
  {
    id: 1,
    title: "40 HP compressor tripping on high discharge temp",
    equipmentLookupId: 3,
    description: "Unit trips after about 40 minutes at full load. Shop air pressure drops with it.",
    status: "Started",
    priority: "Emergency",
    category: "Corrective / Repair",
    assigned: DAVID,
    reportedBy: ALYSSA,
    startDate: day(-1),
    dueDate: day(0),
    techNotes: "Cooler face is packed with dust. Blowing it out and re-testing under load.",
    downtimeHours: 4.5,
    createdDaysAgo: 2,
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
  },
  {
    id: 2,
    title: "Reflow oven monthly profile verification",
    equipmentLookupId: 8,
    scheduleLookupId: 3,
    description: "Ten-zone profile run and trace filed with QC.",
    status: "Up Next",
    priority: "High",
    category: "Calibration",
    assigned: ALYSSA,
    dueDate: day(-11),
    dueStatus: "Late",
    createdDaysAgo: 12,
  },
  {
    id: 3,
    title: "Coil winder #4 spindle bearing failure",
    equipmentLookupId: 9,
    description: "Machine is down. Loud rumble from the head-stock and visible runout on the mandrel.",
    status: "Awaiting Parts",
    priority: "High",
    category: "Corrective / Repair",
    assigned: AMANDA,
    reportedBy: AMANDA,
    startDate: day(-6),
    dueDate: day(3),
    techNotes: "Bearing set ordered from Marsilli, quoted 9 working days.",
    partsUsed: "Spindle bearing kit MC-204-BRG (on order)",
    downtimeHours: 96,
    createdDaysAgo: 6,
    department: "COILS",
    location: "COIL DEPARTMENT",
  },
  {
    id: 4,
    title: "Weekly compressor walkaround",
    equipmentLookupId: 2,
    scheduleLookupId: 1,
    description: "Oil level, receiver drain, leak check, discharge pressure logged.",
    status: "Backlog",
    priority: "Med",
    category: "Inspection",
    assigned: DAVID,
    dueDate: day(2),
    dueStatus: "On-Track",
    createdDaysAgo: 1,
  },
  {
    id: 5,
    title: "Kitamura way lube top-up and coolant check",
    equipmentLookupId: 10,
    scheduleLookupId: 6,
    // The checklist this PM's schedule produced, half worked. The two ticks
    // carry real attribution — the point of the feature is that a tick says
    // WHO and WHEN, which an empty demo checklist can never show.
    description: [
      `- [x] Top up the way lube reservoir${tickedBy("David Bulkley", -1)}`,
      `- [x] Check the coolant concentration with the refractometer${tickedBy("David Bulkley", -1)}`,
      "- [ ] Skim the tramp oil off the tank",
      "- [ ] Log the reading on the work order",
      "Concentration should read 7-9%. Below 6% and the coolant goes off inside a week.",
    ].join("\n"),
    status: "Up Next",
    priority: "Med",
    category: "Preventive",
    assigned: DAVID,
    dueDate: day(1),
    dueStatus: "On-Track",
    createdDaysAgo: 3,
  },
  {
    id: 6,
    title: "Conformal coater nozzle clean",
    equipmentLookupId: 7,
    scheduleLookupId: 5,
    status: "Backlog",
    priority: "Med",
    category: "Cleaning",
    assigned: ERIC,
    dueDate: day(4),
    dueStatus: "On-Track",
    createdDaysAgo: 2,
    department: "PCB",
    location: "DIP ROOM",
    operationsProjectLookupId: 3,
  },
  {
    id: 7,
    title: "Replace worn forks on TM1",
    equipmentLookupId: 1,
    description: "Fork heel wear measured at 11% — over the 10% condemnation limit.",
    status: "Awaiting Parts",
    priority: "High",
    category: "Safety",
    assigned: DAVID,
    reportedBy: DAVID,
    dueDate: day(9),
    partsUsed: "Class II forks, 42in pair (on order)",
    createdDaysAgo: 8,
  },
  {
    id: 8,
    title: "Air dryer condensate drain sticking",
    equipmentLookupId: 6,
    description: "Timed drain not opening reliably; water carrying over into the main header.",
    status: "On Hold",
    priority: "Med",
    category: "Corrective / Repair",
    assigned: DAVID,
    reportedBy: ERIC,
    dueDate: day(14),
    techNotes: "Holding until the shutdown window on the 40 HP unit so the header can be isolated.",
    createdDaysAgo: 15,
  },
  {
    id: 9,
    title: "Fadal 6030 spindle noise investigation",
    equipmentLookupId: 11,
    description: "Intermittent noise above 6000 rpm. No dimensional impact seen yet.",
    status: "Started",
    priority: "Med",
    category: "Inspection",
    assigned: DAVID,
    reportedBy: DAVID,
    startDate: day(-2),
    dueDate: day(5),
    techNotes: "Vibration readings taken at 4k/6k/8k rpm. Comparing against last year's baseline.",
    laborHours: 2,
    createdDaysAgo: 4,
  },
  {
    id: 10,
    title: "Potting oven door seal replacement",
    equipmentLookupId: 12,
    status: "Backlog",
    priority: "Low",
    category: "Preventive",
    assigned: AMANDA,
    dueDate: day(21),
    createdDaysAgo: 10,
  },
  {
    id: 11,
    title: "Add second air line drop at harness bench 3",
    equipmentLookupId: 14,
    description: "Operators are swapping one line between two crimpers.",
    status: "Backlog",
    priority: "Low",
    category: "Improvement",
    reportedBy: ALYSSA,
    dueDate: day(30),
    createdDaysAgo: 18,
    department: "Panels",
    location: "HARNESS DEPARTMENT",
  },
  {
    id: 12,
    title: "CMM annual calibration visit",
    equipmentLookupId: 13,
    scheduleLookupId: 4,
    description: "Vendor attendance booked. Machine to be free from 08:00.",
    status: "Up Next",
    priority: "High",
    category: "Calibration",
    assigned: ERIC,
    dueDate: day(35),
    dueStatus: "On-Track",
    createdDaysAgo: 5,
  },
  {
    id: 13,
    title: "Towmotor monthly safety inspection",
    equipmentLookupId: 1,
    scheduleLookupId: 7,
    // A closed-out checklist: every step ticked, each one attributed. Pairs
    // with work order 5 (the same feature, half done) so the demo shows both
    // ends of a job.
    description: [
      `- [x] Forks — check for cracks, wear and a bent tip${tickedBy("David Bulkley", -11)}`,
      `- [x] Mast chains — tension even, no stretched or seized links${tickedBy("David Bulkley", -11)}`,
      `- [x] Horn sounds${tickedBy("David Bulkley", -11)}`,
      `- [x] Lights and beacon work${tickedBy("David Bulkley", -11)}`,
      `- [x] Service brake and parking brake hold on the ramp${tickedBy("David Bulkley", -11)}`,
      `- [x] Tyres and wheel nuts${tickedBy("David Bulkley", -11)}`,
      `- [x] Seat belt latches and retracts${tickedBy("David Bulkley", -11)}`,
      "Tag out immediately if anything fails — do not leave it for the next shift.",
    ].join("\n"),
    status: "Complete",
    priority: "High",
    category: "Safety",
    assigned: DAVID,
    completedBy: DAVID,
    startDate: day(-11),
    dueDate: day(-11),
    completedDate: day(-11),
    resolution: "All checks passed. Horn volume noted as marginal; re-check next month.",
    laborHours: 1,
    downtimeHours: 1,
    createdDaysAgo: 13,
  },
  {
    id: 14,
    title: "20 HP compressor oil and filter change",
    equipmentLookupId: 2,
    description: "Routine oil change on the panels-side unit.",
    status: "Complete",
    priority: "Med",
    category: "Oil Change",
    assigned: DAVID,
    completedBy: DAVID,
    startDate: day(-5),
    dueDate: day(-5),
    completedDate: day(-5),
    resolution: "Oil, filter and separator replaced. Ran 30 minutes at load with no alarms.",
    partsUsed: "Ultra Coolant 5gal, filter 39911631, separator 42852336",
    laborHours: 2.5,
    downtimeHours: 2.5,
    createdDaysAgo: 7,
  },
  {
    id: 15,
    title: "Reflow oven zone 6 heater element failure",
    equipmentLookupId: 8,
    description: "Zone 6 would not reach set point; boards held at the entry conveyor.",
    status: "Complete",
    priority: "Emergency",
    category: "Corrective / Repair",
    assigned: ALYSSA,
    reportedBy: ALYSSA,
    completedBy: ALYSSA,
    startDate: day(-23),
    dueDate: day(-22),
    completedDate: day(-22),
    failureCause: "Heater element open circuit — element at end of life, 2,100 hours over rating.",
    resolution: "Element and thermocouple replaced, profile re-verified and signed off by QC.",
    partsUsed: "Heller heater element 1913-Z6, K-type thermocouple",
    laborHours: 6,
    downtimeHours: 11,
    createdDaysAgo: 23,
  },
  {
    id: 16,
    title: "Cut/strip blade replacement",
    equipmentLookupId: 14,
    scheduleLookupId: 9,
    status: "Complete",
    priority: "Low",
    category: "Preventive",
    assigned: ALYSSA,
    completedBy: ALYSSA,
    startDate: day(-64),
    dueDate: day(-64),
    completedDate: day(-64),
    resolution: "Blades replaced, first-article sample re-run and passed.",
    partsUsed: "Komax blade set K330-BS",
    laborHours: 1.5,
    downtimeHours: 1.5,
    createdDaysAgo: 66,
    department: "PROD",
    location: "HARNESS DEPARTMENT",
  },
  {
    id: 17,
    title: "Conformal coater nozzle clean",
    equipmentLookupId: 7,
    scheduleLookupId: 5,
    status: "Complete",
    priority: "Med",
    category: "Cleaning",
    assigned: ERIC,
    completedBy: ERIC,
    startDate: day(-10),
    dueDate: day(-10),
    completedDate: day(-10),
    resolution: "Nozzles purged and cleaned. Flow even across the test coupon.",
    laborHours: 1.5,
    createdDaysAgo: 12,
  },
  {
    id: 18,
    title: "5000 Digital test stand relay chatter",
    equipmentLookupId: 5,
    description: "Intermittent chatter on the output relay bank during endurance runs.",
    status: "Complete",
    priority: "High",
    category: "Corrective / Repair",
    assigned: ERIC,
    reportedBy: ERIC,
    completedBy: ERIC,
    startDate: day(-31),
    dueDate: day(-29),
    completedDate: day(-30),
    failureCause: "Contact erosion on relay K4 after roughly 900,000 cycles.",
    resolution: "Relay bank replaced and the stand re-validated against the reference unit.",
    partsUsed: "Relay bank RB-5000-2",
    laborHours: 4,
    downtimeHours: 5,
    createdDaysAgo: 32,
  },
  {
    id: 19,
    title: "Kitamura coolant tank clean-out",
    equipmentLookupId: 10,
    status: "Complete",
    priority: "Med",
    category: "Cleaning",
    assigned: DAVID,
    completedBy: DAVID,
    startDate: day(-45),
    dueDate: day(-44),
    completedDate: day(-44),
    resolution: "Tank drained, swarf removed, refilled at 7% concentration.",
    laborHours: 5,
    downtimeHours: 8,
    createdDaysAgo: 47,
  },
  {
    id: 20,
    title: "Potting oven temperature verification",
    equipmentLookupId: 12,
    scheduleLookupId: 8,
    status: "Complete",
    priority: "Med",
    category: "Calibration",
    assigned: AMANDA,
    completedBy: AMANDA,
    startDate: day(-110),
    dueDate: day(-110),
    completedDate: day(-110),
    resolution: "Set point verified at 150C, deviation +1.2C — inside tolerance.",
    laborHours: 3,
    createdDaysAgo: 112,
  },
  {
    id: 21,
    title: "Replace shop-air quick couplers at bench 7",
    equipmentLookupId: null,
    description: "General shop request, not tied to a numbered asset.",
    status: "Complete",
    priority: "Low",
    category: "Improvement",
    reportedBy: AMANDA,
    completedBy: DAVID,
    assigned: DAVID,
    startDate: day(-19),
    dueDate: day(-18),
    completedDate: day(-18),
    resolution: "Four couplers replaced with the standard 1/4in industrial pattern.",
    laborHours: 1,
    createdDaysAgo: 21,
    department: "PROD",
    location: "PRODUCTION",
  },
  {
    id: 22,
    title: "Investigate vapour degreaser for reinstatement",
    equipmentLookupId: 15,
    description: "Asked whether the retired unit could be brought back for a one-off job.",
    status: "Canceled",
    priority: "Low",
    category: "Inspection",
    reportedBy: RAY,
    assigned: DAVID,
    dueDate: day(-40),
    resolution: "Cancelled — the unit is retired and the solvent is no longer stocked on site.",
    createdDaysAgo: 55,
  },
  {
    id: 23,
    title: "Duplicate: reflow oven zone 6 fault",
    equipmentLookupId: 8,
    description: "Raised a second time before the original was closed out.",
    status: "Canceled",
    priority: "High",
    category: "Corrective / Repair",
    reportedBy: ALYSSA,
    dueDate: day(-22),
    resolution: "Cancelled as a duplicate of the original zone 6 work order.",
    createdDaysAgo: 23,
  },
  {
    id: 24,
    title: "Standby compressor monthly run-up",
    equipmentLookupId: 4,
    description: "Run the standby unit for 30 minutes and confirm it carries the header alone.",
    status: "Backlog",
    priority: "Low",
    category: "Preventive",
    assigned: DAVID,
    dueDate: day(-4),
    dueStatus: "Late",
    createdDaysAgo: 9,
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
  },
  {
    id: 25,
    title: "Label and photograph all LOTO points in the compressor room",
    equipmentLookupId: 3,
    description: "Isolation points are unlabelled, which slows every shutdown job on this line.",
    status: "On Hold",
    priority: "Med",
    category: "Safety",
    reportedBy: RAY,
    assigned: ERIC,
    dueDate: day(45),
    techNotes: "Waiting on the printed tag stock.",
    createdDaysAgo: 26,
    department: "MACH SHOP",
    location: "COMPRESSOR ROOM",
    operationsProjectLookupId: 4,
  },
];

export const MOCK_MAINTENANCE_TASKS: MaintenanceTask[] = WORK_ORDER_SEEDS.map((s) => {
  const assigned = s.assigned ?? null;
  const reportedBy = s.reportedBy ?? null;
  return {
    id: s.id,
    woNumber: s.woNumber ?? wo(s.id),
    title: s.title,
    description: s.description ?? "",
    status: s.status ?? "Backlog",
    priority: s.priority ?? null,
    category: s.category ?? null,
    // Derived exactly as ARC derives it — never seeded independently, or the
    // demo would show a combination the real list can't produce.
    taskType: s.scheduleLookupId ? "Regular Maintenance" : "Request",
    dueStatus: s.dueStatus ?? null,
    startDate: s.startDate ?? null,
    dueDate: s.dueDate ?? null,
    completedDate: s.completedDate ?? null,
    equipment: s.equipmentLookupId ? assetRef(s.equipmentLookupId) : null,
    scheduleRef: s.scheduleLookupId ? scheduleRef(s.scheduleLookupId) : null,
    operationsTaskRef: s.operationsTaskRef ?? null,
    operationsProject: s.operationsProjectLookupId
      ? operationsProjectRef(s.operationsProjectLookupId)
      : null,
    // The work order's OWN department and location. Deliberately blank on
    // most seeds — a column added this week is blank on nearly every existing
    // row, and a demo where every record is filled in hides that.
    department: departmentRef(s.department),
    location: locationRef(s.location),
    assigned,
    reportedBy,
    completedBy: s.completedBy ?? null,
    watchers:
      s.watchers ??
      ([assigned, reportedBy, RAY].filter(Boolean) as Person[]).filter(
        (p, i, all) => all.findIndex((q) => q.email === p.email) === i,
      ),
    techNotes: s.techNotes ?? "",
    failureCause: s.failureCause ?? "",
    resolution: s.resolution ?? "",
    partsUsed: s.partsUsed ?? "",
    laborHours: s.laborHours ?? null,
    downtimeHours: s.downtimeHours ?? null,
    comments: s.comments ?? [],
    hasAttachments: s.hasAttachments ?? false,
    createdAt: stamp(-s.createdDaysAgo),
    modifiedAt: stamp(-Math.max(0, Math.min(s.createdDaysAgo, 3))),
  };
});

// A couple of threads so the comment UI has something to render in the demo.
MOCK_MAINTENANCE_TASKS[0].comments = [
  {
    timestamp: stamp(-1),
    authorName: "David Bulkley",
    authorEmail: "david.bulkley@altronic-llc.com",
    bodyHtml: "<p>Cooler face was completely blocked. Cleaning it now, will re-test under load.</p>",
    attachments: [],
  },
  {
    timestamp: stamp(-2),
    authorName: "Alyssa Garrett",
    authorEmail: "alyssa.garrett@altronic-llc.com",
    bodyHtml: "<p>Tripped twice this shift. SMT is running on the 20 HP unit in the meantime.</p>",
    attachments: [],
  },
];
MOCK_MAINTENANCE_TASKS[2].comments = [
  {
    timestamp: stamp(-4),
    authorName: "Amanda Hoagland",
    authorEmail: "amanda.hoagland@altronic-llc.com",
    bodyHtml: "<p>Bearing kit is quoted nine working days. Winder #2 is covering the schedule.</p>",
    attachments: [],
  },
];
