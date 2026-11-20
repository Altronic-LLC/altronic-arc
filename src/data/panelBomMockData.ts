import type { PanelBom, PanelBomKit, PanelBomPart, PanelBomPicks } from "@/types/panelBom";
import { computePanelBom } from "@/lib/panelBom";

// =============================================================================
// Panel SAP BOM Builder — demo data. EVERY part, kit, number and cost here is
// INVENTED (rule 8: the repo is public, and the real parts database carries
// COGS). Shaped like the live lists: a part on two rows in two categories, a
// Do Not Quote part, a retired part, and a kit with components that have no
// SAP # (the real list has one such kit).
// =============================================================================

let nextId = 1;
function part(
  sap: string,
  alt: string,
  description: string,
  cluster: number,
  category: string,
  extra: Partial<PanelBomPart> = {},
): PanelBomPart {
  return {
    id: nextId++,
    sapPartNumber: sap,
    altronicPartNumber: alt,
    description,
    cluster,
    category,
    standard: false,
    preferred: false,
    doNotQuote: false,
    datasheet: "",
    qtyIfUsed: null,
    active: true,
    ...extra,
  };
}

export const MOCK_PANEL_BOM_PARTS: PanelBomPart[] = [
  part("9001-0100-00", "ENC-3624-12", "Enclosure, 36\"H x 24\"W x 12\"D, painted steel", 0, "Enclosures", { standard: true, preferred: true, qtyIfUsed: 1, datasheet: "enc-3624.pdf" }),
  part("9001-0101-00", "ENC-4830-14", "Enclosure, 48\"H x 30\"W x 14\"D, painted steel", 0, "Enclosures", { qtyIfUsed: 1 }),
  part("9001-0110-00", "BP-3624", "Back panel, 33\" x 21\"", 0, "Back Panels", { qtyIfUsed: 1 }),
  part("9001-0120-00", "LL-12", "Lift lug, 1/2\" eye", 0, "Mounting Hardware", { qtyIfUsed: 4 }),
  part("9001-0121-00", "CG-075", "Cord grip, 3/4\" NPT", 0, "Cord Grips & Nuts", { qtyIfUsed: 2, datasheet: "cg-075.pdf" }),
  part("9001-0122-00", "CG-100", "Cord grip, 1\" NPT", 0, "Cord Grips & Nuts", { qtyIfUsed: 1 }),
  part("9002-0200-00", "DEMO-CTRL-1", "Engine controller, demo model 1", 1, "Controllers", { preferred: true, qtyIfUsed: 1 }),
  part("9002-0201-00", "DEMO-IGN-16", "Ignition system, 16 cylinder demo", 1, "Ignition", { qtyIfUsed: 1 }),
  part("9002-0202-00", "DEMO-DISP-7", "Display, 7\" touch (demo)", 1, "Displays", { qtyIfUsed: 1 }),
  part("9003-0300-00", "PLC-CPU-A", "PLC processor, demo series A", 2, "PLCs", { preferred: true, qtyIfUsed: 1 }),
  part("9003-0301-00", "PLC-DI-16", "PLC digital input card, 16 point", 2, "PLCs", { qtyIfUsed: 2 }),
  part("9003-0302-00", "RLY-24-4P", "Relay, 24 VDC, 4 pole", 2, "Relays", { standard: true, qtyIfUsed: 6 }),
  part("9003-0303-00", "RLY-24-2P", "Relay, 24 VDC, 2 pole (superseded)", 2, "Relays", { doNotQuote: true }),
  part("9004-0400-00", "SOL-24-NC", "Solenoid valve, 24 VDC, normally closed", 3, "Valves", { qtyIfUsed: 1 }),
  part("9004-0401-00", "REG-0-100", "Pressure regulator, 0–100 psi", 3, "Regulators", { qtyIfUsed: 1 }),
  part("9005-0500-00", "TB-2.5-GY", "Terminal block, 2.5 mm, grey", 4, "Terminal Blocks", { standard: true, preferred: true, qtyIfUsed: 40 }),
  part("9005-0501-00", "TB-2.5-END", "Terminal block end cover", 4, "Terminal Blocks", { qtyIfUsed: 4 }),
  part("9005-0502-00", "WD-2X3", "Wire duct, 2\" x 3\", 6 ft", 4, "Wire Duct", { qtyIfUsed: 3 }),
  part("9005-0503-00", "DIN-35-1M", "DIN rail, 35 mm, 1 m", 4, "DIN Rail", { qtyIfUsed: 2 }),
  part("9006-0600-00", "PS-24-10", "Power supply, 24 VDC, 10 A", 5, "Power Supplies", { preferred: true, qtyIfUsed: 1 }),
  part("9006-0601-00", "CB-1P-10", "Circuit breaker, 1 pole, 10 A", 5, "Breakers", { standard: true, qtyIfUsed: 4 }),
  part("9006-0602-00", "FUSE-5A", "Fuse, 5 A, time delay", 5, "Fuses", { qtyIfUsed: 6 }),
  part("9006-0603-00", "FUSE-5A-OLD", "Fuse, 5 A (old style)", 5, "Fuses", { active: false }),
  part("9007-0700-00", "PB-RED-22", "Push button, red, 22 mm", 6, "Operator Devices", { qtyIfUsed: 1 }),
  part("9007-0701-00", "PL-GRN-22", "Pilot light, green, 22 mm", 6, "Operator Devices", { qtyIfUsed: 2 }),
  part("9007-0702-00", "ESTOP-40", "E-stop, 40 mm mushroom", 6, "Operator Devices", { standard: true, qtyIfUsed: 1 }),
  part("9008-0800-00", "CBL-4C-18", "Cable, 4 conductor, 18 AWG, per ft", 7, "Cables", { qtyIfUsed: 25 }),
  part("9008-0801-00", "LBL-NAME", "Nameplate label, engraved", 7, "Labels", { qtyIfUsed: 1 }),
  part("9009-0900-00", "CUST-SUPPLIED", "Customer supplied item (reference)", 8, "Reference"),
  part("9010-1000-00", "SPARE-FUSE-KIT", "Spare fuse kit, ship loose", 9, "Spares", { qtyIfUsed: 1 }),
  // The same SAP # on two rows, in two categories — the live list has five.
  part("9005-0500-00", "TB-2.5-GY", "Terminal block, 2.5 mm, grey (spares)", 9, "Spares"),
];

export const MOCK_PANEL_BOM_KITS: PanelBomKit[] = [
  {
    id: 1,
    name: "KIT-DEMO-ENC-36",
    description: "Kit - Enclosure 36\" with back panel, lift lugs and cord grips",
    category: "Enclosure Kits",
    standard: true,
    preferred: true,
    active: true,
    componentsCorrupt: false,
    components: [
      { qty: 1, sapPartNumber: "9001-0100-00", mfgPartNumber: "ENC-3624-12", description: "Enclosure, 36\"H x 24\"W x 12\"D" },
      { qty: 1, sapPartNumber: "9001-0110-00", mfgPartNumber: "BP-3624", description: "Back panel" },
      { qty: 4, sapPartNumber: "9001-0120-00", mfgPartNumber: "LL-12", description: "Lift lug" },
      { qty: 2, sapPartNumber: "9001-0121-00", mfgPartNumber: "CG-075", description: "Cord grip, 3/4\"" },
    ],
  },
  {
    id: 2,
    name: "KIT-DEMO-PWR-24",
    description: "Kit - 24 VDC power with breakers and fuses",
    category: "Power Kits",
    standard: false,
    preferred: true,
    active: true,
    componentsCorrupt: false,
    components: [
      { qty: 1, sapPartNumber: "9006-0600-00", mfgPartNumber: "PS-24-10", description: "Power supply, 24 VDC, 10 A" },
      { qty: 2, sapPartNumber: "9006-0601-00", mfgPartNumber: "CB-1P-10", description: "Circuit breaker, 1 pole" },
      { qty: 4, sapPartNumber: "9006-0602-00", mfgPartNumber: "FUSE-5A", description: "Fuse, 5 A" },
    ],
  },
  {
    id: 3,
    name: "KIT-DEMO-PURGE",
    description: "Kit - Purge system, general purpose (some parts not in SAP)",
    category: "Purge Kits",
    standard: false,
    preferred: false,
    active: true,
    componentsCorrupt: false,
    components: [
      { qty: 1, sapPartNumber: "9004-0401-00", mfgPartNumber: "REG-0-100", description: "Pressure regulator" },
      { qty: 1, sapPartNumber: "", mfgPartNumber: "DEMO-PURGE-CTRL", description: "Purge controller (not in SAP)" },
      { qty: 2, sapPartNumber: "", mfgPartNumber: "DEMO-VENT", description: "Purge vent (not in SAP)" },
    ],
  },
];

/** Invented SAP unit costs for the demo, by SAP #. Two parts deliberately have none. */
export const MOCK_PANEL_BOM_COSTS: Record<string, number> = {
  "9001-0100-00": 1180,
  "9001-0101-00": 1525,
  "9001-0110-00": 96.5,
  "9001-0120-00": 4.2,
  "9001-0121-00": 6.75,
  "9001-0122-00": 7.9,
  "9002-0200-00": 2450,
  "9002-0201-00": 1890,
  "9002-0202-00": 640,
  "9003-0300-00": 980,
  "9003-0301-00": 310,
  "9003-0302-00": 18.4,
  "9004-0400-00": 142,
  "9004-0401-00": 88,
  "9005-0500-00": 0.95,
  "9005-0501-00": 0.4,
  "9005-0502-00": 22.5,
  "9005-0503-00": 9.8,
  "9006-0600-00": 214,
  "9006-0601-00": 31.5,
  "9006-0602-00": 2.15,
  "9007-0700-00": 24,
  "9007-0701-00": 21,
  "9007-0702-00": 58,
  "9008-0800-00": 1.1,
  "9008-0801-00": 12,
  "9010-1000-00": 45,
};

const DEMO_PICKS: PanelBomPicks = {
  parts: { "9002-0200-00": 1, "9005-0500-00": 40, "9007-0702-00": 1 },
  kits: { "KIT-DEMO-ENC-36": 1, "KIT-DEMO-PWR-24": 1 },
};
const DEMO_RESULT = computePanelBom(MOCK_PANEL_BOM_PARTS, MOCK_PANEL_BOM_KITS, DEMO_PICKS);

export const MOCK_PANEL_BOMS: PanelBom[] = [
  {
    id: 1,
    panelSystemNumber: "DEMO-PS-1001",
    notes: "First pass for the demo order.",
    panelOrder: { lookupId: 1, title: "" },
    picks: DEMO_PICKS,
    picksCorrupt: false,
    savedLines: DEMO_RESULT.lines,
    savedManual: DEMO_RESULT.manual,
    createdBy: { displayName: "Demo User", email: "demo.user@example.com" },
    createdAt: new Date("2026-11-03T15:00:00Z"),
    modifiedBy: { displayName: "Demo User", email: "demo.user@example.com" },
    modifiedAt: new Date("2026-11-03T15:00:00Z"),
  },
];
