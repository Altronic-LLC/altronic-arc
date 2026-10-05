import type { AltronicComponent, AltronicPart, ItemAuthor } from "@/types/task";

// =============================================================================
// Sample Altronic Parts List data — a handful of parts across several books,
// and components in every HCO list, shaped like the real load:
//
//  - Most rows are LEGACY: blank sign-off, a LegacySource pointing at the old
//    list. A couple are new (no LegacySource) and mid-approval, so the
//    sign-off chips have something to show.
//  - Descriptions carry the component type up front ("RESISTOR - FILM"), which
//    is what the Rating A/B/C labels are read from.
//  - 601427HT has a suffix, and 610086 is in the big 610/615 list, because
//    both are real shapes the prefix rules have to handle.
// =============================================================================

const at = (iso: string) => new Date(iso);
const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** Every loaded row's createdBy is the account that ran the load script. */
const LOAD_ACCOUNT: ItemAuthor = { displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };
const BRANDON: ItemAuthor = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const GLENN: ItemAuthor = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };

function part(p: Partial<AltronicPart> & Pick<AltronicPart, "id" | "partNumber" | "description">): AltronicPart {
  return {
    dateAssigned: null,
    drawingSize: "",
    dateDrawing: null,
    manufacturer: "",
    mfgPartNumber: "",
    notes: "",
    assignedBy: "",
    prototypeOrProduction: null,
    purchased: null,
    sapNumber: "",
    itemValue: "",
    signOffStatus: null,
    legacySource: "",
    comments: [],
    createdBy: LOAD_ACCOUNT,
    hasAttachments: false,
    createdAt: at("2026-09-28T14:00:00Z"),
    modifiedAt: at("2026-09-28T14:00:00Z"),
    ...p,
  };
}

function component(
  c: Partial<AltronicComponent> & Pick<AltronicComponent, "id" | "partNumber" | "description" | "category">,
): AltronicComponent {
  return {
    mfgName: "",
    mfgNumber: "",
    ratingA: "",
    ratingB: "",
    ratingC: "",
    tempMin: "",
    tempMax: "",
    tolerance: "",
    footprint: "",
    notes: "",
    hasDataSheet: false,
    signOffStatus: null,
    legacySource: "",
    comments: [],
    createdBy: LOAD_ACCOUNT,
    hasAttachments: false,
    createdAt: at("2026-09-28T14:00:00Z"),
    modifiedAt: at("2026-09-28T14:00:00Z"),
    ...c,
  };
}

export const MOCK_ALTRONIC_PARTS: AltronicPart[] = [
  part({ id: 1, partNumber: "101022", description: "Switch - SPST/NO - 2 Position - A22S2M10 - Omron", dateAssigned: day("2007-12-03"), dateDrawing: day("2007-12-03"), assignedBy: "SL", purchased: "Purchased", legacySource: "101#2" }),
  part({ id: 2, partNumber: "101023", description: 'Magnet Bar 5 1/4"', dateAssigned: day("1965-09-16"), dateDrawing: day("1965-09-16"), drawingSize: "B", purchased: "Not Purchased", legacySource: "101#3" }),
  part({ id: 3, partNumber: "101233", description: "Assembly - Pick-up Coil and Cable", dateAssigned: day("1981-06-21"), dateDrawing: day("1981-06-23"), drawingSize: "C", purchased: "Not Purchased", prototypeOrProduction: "Production", legacySource: "101#18" }),
  part({ id: 4, partNumber: "204602", description: "Terminal - Solder - 1/4 - Spade", dateAssigned: day("2026-09-10"), assignedBy: "GT", purchased: "Purchased", manufacturer: "Keystone", mfgPartNumber: "1287-ST", legacySource: "204#17" }),
  part({ id: 5, partNumber: "309114", description: "Label - Nameplate - CPU-95", dateAssigned: day("1998-04-02"), drawingSize: "A", purchased: "Not Purchased", legacySource: "309#114" }),
  part({ id: 6, partNumber: "309115", description: "Label - Warning - High Voltage", dateAssigned: day("1998-04-02"), drawingSize: "A", purchased: "Not Purchased", legacySource: "309#115" }),
  part({ id: 7, partNumber: "501204", description: "Harness - Sensor - 12 Pin", dateAssigned: day("2012-02-14"), drawingSize: "B", purchased: "Not Purchased", prototypeOrProduction: "Production", legacySource: "501#204" }),
  part({ id: 8, partNumber: "503761", description: "Harness - Output - 18 Cylinder", dateAssigned: day("2016-11-01"), drawingSize: "C", purchased: "Not Purchased", legacySource: "503#761" }),
  part({ id: 9, partNumber: "504017", description: "Lug - Terminal - Stakeproof - 2 AWG", dateAssigned: day("2003-07-22"), manufacturer: "Panduit", mfgPartNumber: "LCA2-14-L", purchased: "Purchased", legacySource: "504#17" }),
  part({ id: 10, partNumber: "599078", description: "Sales Drawing - AT Coil - Black", dateAssigned: day("2019-05-30"), drawingSize: "B", purchased: "Not Purchased", legacySource: "599#49" }),
  part({ id: 11, partNumber: "602350", description: "Screw - Pan Head - 6-32 x 3/8 - SS", purchased: "Purchased", manufacturer: "McMaster-Carr", mfgPartNumber: "91772A146", legacySource: "602#350" }),
  part({ id: 12, partNumber: "604596", description: "Connector, USB 2.0, Type C, SM, Horizontal", dateAssigned: day("2025-03-11"), purchased: "Purchased", manufacturer: "GCT", mfgPartNumber: "USB4105-GF-A", legacySource: "604#493" }),
  part({ id: 13, partNumber: "610086", description: "Magnetic Pickup Body", dateAssigned: day("1994-01-18"), drawingSize: "B", purchased: "Not Purchased", legacySource: "610/615#1003" }),
  part({ id: 14, partNumber: "615891", description: "Neural Processing Unit (NPU) Module", dateAssigned: day("2026-08-04"), purchased: "Purchased", prototypeOrProduction: "Prototype", notes: "Evaluation part for the NGI-3000 display.", legacySource: "610/615#1879" }),
  part({ id: 15, partNumber: "632018", description: "PCB, Logic, IPM-D", dateAssigned: day("2024-06-12"), drawingSize: "C", purchased: "Purchased", prototypeOrProduction: "Production", legacySource: "632#22" }),
  part({ id: 16, partNumber: "672364", description: "PCB Assembly, USB Modbus", dateAssigned: day("2024-06-12"), drawingSize: "C", purchased: "Not Purchased", legacySource: "672#359" }),
  part({ id: 17, partNumber: "691834", description: "Final Assembly, USB Modbus", dateAssigned: day("2024-06-12"), drawingSize: "D", purchased: "Not Purchased", prototypeOrProduction: "Production", legacySource: "691#417" }),
  part({ id: 18, partNumber: "710457", description: "Front Cover, Painted, NGI-3000 Display", dateAssigned: day("2025-10-02"), drawingSize: "C", purchased: "Purchased", legacySource: "710#455" }),
  part({ id: 19, partNumber: "732003", description: "Overlay Adhesive Backing, Display, NGI-3000", dateAssigned: day("2026-09-28"), assignedBy: "SH", purchased: "Purchased", legacySource: "732#4" }),
  part({ id: 20, partNumber: "791950-08", description: "CPU-95 - 8 Cylinder - Final Assembly", dateAssigned: day("2001-03-09"), drawingSize: "D", purchased: "Not Purchased", legacySource: "791#12" }),
  part({ id: 21, partNumber: "810129", description: "Pressure Transducer - Housing - Plug", dateAssigned: day("2008-08-19"), drawingSize: "B", purchased: "Not Purchased", legacySource: "810#129" }),
  part({ id: 22, partNumber: "902451", description: "Kit - Service - Spark Plug Leads", dateAssigned: day("2015-01-27"), purchased: "Not Purchased", legacySource: "902#451" }),
  // New since the load: raised in ARC, waiting on SAP.
  part({ id: 23, partNumber: "604612", description: "Connector, Header, 2x5, 2.54mm, Shrouded", dateAssigned: day("2026-09-26"), assignedBy: "BM", purchased: "Purchased", manufacturer: "Wurth", mfgPartNumber: "61201021621", signOffStatus: "Pending SAP", createdBy: BRANDON }),
  part({ id: 24, partNumber: "501905", description: "Harness - Display - NGI-3000", dateAssigned: day("2026-09-20"), assignedBy: "GT", drawingSize: "B", purchased: "Not Purchased", prototypeOrProduction: "Prototype", sapNumber: "1027-5512-00", signOffStatus: "Approved", createdBy: GLENN }),
];

/**
 * Which mock parts have a PDF in General/Datasheets. For components,
 * deliberately NOT the same set as `hasDataSheet`, because the live data
 * isn't either:
 *   601466, 712044  flagged, and the file is there
 *   701212          flagged, but NO file   (18 like it live)
 *   601110          NOT flagged, but a file (380 like it live)
 * And one Part List part, which has no flag column at all:
 *   204602          a purchased terminal with a datasheet
 */
export const MOCK_DATASHEET_PART_NUMBERS: readonly string[] = ["601466", "712044", "601110", "204602"];

export const MOCK_ALTRONIC_COMPONENTS: AltronicComponent[] = [
  component({ id: 1, partNumber: "601110", category: "Through Hole", description: "RESISTOR", mfgName: "VISHAY", mfgNumber: "MBA02040C1003FRP00", ratingA: "100K", ratingB: "1/4W", ratingC: "200V", tolerance: "1%", tempMin: "-55", tempMax: "155", footprint: "AXIAL-0.4", legacySource: "Through Hole Parts#1065" }),
  component({ id: 2, partNumber: "601138", category: "Through Hole", description: "CAPACITOR - CERAMIC", mfgName: "VISHAY", mfgNumber: "K102M15X7RF53L2", ratingA: "1000pF", ratingB: "50V", ratingC: "X7R", tolerance: "20%", tempMin: "-55", tempMax: "125", footprint: "RAD-0.2", legacySource: "Through Hole Parts#1089" }),
  component({ id: 3, partNumber: "601326", category: "Through Hole", description: "OBSOLETE - IC - OPTO COUPLER", mfgName: "GE", mfgNumber: "4N37", tempMin: "-55", tempMax: "100", footprint: "DIP-6", notes: "Obsolete — use 611086 on new designs.", legacySource: "Through Hole Parts#1253" }),
  component({ id: 4, partNumber: "601427HT", category: "Through Hole", description: "TRANSFORMER - CUSTOM", mfgName: "Custom Bobbin", mfgNumber: "818-135", footprint: "CUSTOM", legacySource: "Through Hole Parts#1322" }),
  component({ id: 5, partNumber: "601466", category: "Through Hole", description: "RESISTOR NETWORK", mfgName: "PACKAGED POWER", mfgNumber: "4116R-001-101", ratingA: "100", ratingB: "8", ratingC: "Isolated", tolerance: "2%", footprint: "DIP-16", notes: "Alternate Mfg #: 4116R-1-101LF", hasDataSheet: true, legacySource: "Through Hole Parts#1382" }),
  component({ id: 6, partNumber: "611075", category: "Through Hole", description: "DIODE - ZENER", mfgName: "ON SEMICONDUCTORS", mfgNumber: "1N5334BRLG", ratingA: "3.6V", ratingB: "5W", ratingC: "1.3A", tempMin: "-65", tempMax: "200", footprint: "AXIAL-0.6", legacySource: "Through Hole Parts#1849" }),
  component({ id: 7, partNumber: "611080", category: "Through Hole", description: "BATTERY - LITHIUM - 3.6V", mfgName: "TADIRAN", mfgNumber: "TLH-2450/P", ratingA: "3.6V", ratingB: "1.2Ah", ratingC: "i3 lithium", tempMin: "-55", tempMax: "125", legacySource: "Through Hole Parts#1854" }),
  component({ id: 8, partNumber: "611114", category: "Through Hole", description: "OSCILLATOR", mfgName: "CTS", mfgNumber: "MXO45HS-3C-20M0000", ratingA: "20MHz", ratingB: "5V", ratingC: "24mA", footprint: "DIP-8", legacySource: "Through Hole Parts#1885" }),
  component({ id: 9, partNumber: "701043", category: "Surface Mount", description: "RESISTOR", mfgName: "YAGEO", mfgNumber: "RC0603FR-0710KL", ratingA: "10K", ratingB: "1/10W", ratingC: "75V", tolerance: "1%", tempMin: "-55", tempMax: "155", footprint: "0603", legacySource: "Surface Mount Parts#315" }),
  component({ id: 10, partNumber: "701212", category: "Surface Mount", description: "CAPACITOR - CERAMIC", mfgName: "MURATA", mfgNumber: "GRM188R71H104KA93D", ratingA: "0.1uF", ratingB: "50V", ratingC: "X7R", tolerance: "10%", tempMin: "-55", tempMax: "125", footprint: "0603", hasDataSheet: true, legacySource: "Surface Mount Parts#801" }),
  component({ id: 11, partNumber: "711508", category: "Surface Mount", description: "DIODE - SCHOTTKY", mfgName: "DIODES INC", mfgNumber: "B340A-13-F", ratingA: "40V", ratingB: "2W", ratingC: "0.5V", tempMin: "-65", tempMax: "150", footprint: "SMA", legacySource: "Surface Mount Parts#1702" }),
  component({ id: 12, partNumber: "711640", category: "Surface Mount", description: "TRANSISTOR - FET - N CHANNEL", mfgName: "INFINEON", mfgNumber: "BSS138", ratingA: "50V", ratingB: "220mA", ratingC: "3.5 ohm", tempMin: "-55", tempMax: "150", footprint: "SOT-23", legacySource: "Surface Mount Parts#1834" }),
  component({ id: 13, partNumber: "712044", category: "Surface Mount", description: "IC - MICROCONTROLLER - 32 BIT", mfgName: "STMICROELECTRONICS", mfgNumber: "STM32F407VGT6", tempMin: "-40", tempMax: "85", footprint: "LQFP-100", hasDataSheet: true, legacySource: "Surface Mount Parts#2460" }),
  component({ id: 14, partNumber: "712101", category: "Surface Mount", description: "INDUCTOR", mfgName: "BOURNS", mfgNumber: "SRR1260-100M", ratingA: "10uH", ratingB: "7.2A", ratingC: "18 mOhm", tolerance: "20%", footprint: "12.5x12.5", legacySource: "Surface Mount Parts#2601" }),
  component({ id: 15, partNumber: "722044", category: "SIL", description: "SIL CAT 2 - BARRIER - ZENER", mfgName: "PEPPERL+FUCHS", mfgNumber: "Z728", notes: "Moved from the 722 numeric list during the 2026 load.", legacySource: "722#1" }),
  component({ id: 16, partNumber: "722051", category: "SIL", description: "SIL CAT 1 - RELAY - SAFETY", mfgName: "PHOENIX", mfgNumber: "2981020", ratingA: "24V", ratingB: "6A", ratingC: "100 mOhm", legacySource: "SIL Parts#88" }),
  // New since the load, working through the three-step approval.
  component({ id: 17, partNumber: "701990", category: "Surface Mount", description: "RESISTOR", mfgName: "PANASONIC", mfgNumber: "ERJ-3EKF4701V", ratingA: "4K7", ratingB: "1/10W", ratingC: "75V", tolerance: "1%", tempMin: "-55", tempMax: "155", footprint: "0603", signOffStatus: "Pending Engineering Review", createdBy: BRANDON }),
  component({
    id: 18, partNumber: "711702", category: "Surface Mount", description: "DIODE - LED", mfgName: "KINGBRIGHT", mfgNumber: "APT1608SGC", ratingA: "5V", ratingB: "2.2V", ratingC: "Green", tolerance: "N/A", tempMin: "-40", tempMax: "85", footprint: "0603", signOffStatus: "Pending SAP", createdBy: BRANDON,
    comments: [
      {
        timestamp: at("2026-09-27T15:12:00Z"),
        authorName: "Glenn Terry",
        authorEmail: "glenn.terry@altronic-llc.com",
        bodyHtml: "<p><strong>Engineering review approved.</strong></p><p>Corrected the forward voltage from 2.0V to 2.2V per the datasheet.</p>",
      },
    ],
  }),
];
