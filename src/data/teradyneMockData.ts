import type {
  TeradyneEmployee,
  TeradyneLogEntry,
  TeradyneProduct,
  TeradyneRemark,
} from "@/types/task";
import { buildTeradyneLogTitle } from "@/lib/teradyneMapper";

// =============================================================================
// Demo-mode fixtures for the Teradyne log. Shapes and values are modelled on
// real rows captured during column discovery (products tested on the Spea
// station, canned remarks, clock numbers on employees) so the demo looks like
// the real thing without containing real production data.
// =============================================================================

export const MOCK_TERADYNE_EMPLOYEES: TeradyneEmployee[] = [
  { lookupId: 2, title: "Dave Anderson", firstName: "Dave", lastName: "Anderson", clockNum: 312, workCenter: "COAT", idEmp: 2 },
  { lookupId: 5, title: "Sandy Bindas", firstName: "Sandy", lastName: "Bindas", clockNum: 189, workCenter: "PCB", idEmp: 5 },
  { lookupId: 8, title: "Melissa Fuentes", firstName: "Melissa", lastName: "Fuentes", clockNum: 88, workCenter: "PCB", idEmp: 9 },
  { lookupId: 11, title: "Tony Marsh", firstName: "Tony", lastName: "Marsh", clockNum: 241, workCenter: "PCB", idEmp: 14 },
  { lookupId: 14, title: "Rita Okafor", firstName: "Rita", lastName: "Okafor", clockNum: 176, workCenter: "TEST", idEmp: 21 },
];

export const MOCK_TERADYNE_PRODUCTS: TeradyneProduct[] = [
  { lookupId: 160, title: "DSG-1201 Back (top pcb)", testOnStation: "Spea", idProd: 160 },
  { lookupId: 201, title: "Moris Power Supply", testOnStation: "Spea", idProd: 201 },
  { lookupId: 208, title: "EX-4000 DA", testOnStation: "Spea", idProd: 208 },
  { lookupId: 214, title: "TEM Power Board", testOnStation: "Spea", idProd: 214 },
  { lookupId: 219, title: "SAVES", testOnStation: "Spea", idProd: 219 },
];

export const MOCK_TERADYNE_REMARKS: TeradyneRemark[] = [
  { lookupId: 1, title: "Solder bridge", idRem: 1 },
  { lookupId: 4, title: "Wrong board", idRem: 4 },
  { lookupId: 9, title: "Cold joint", idRem: 9 },
  { lookupId: 13, title: "Component out of tolerance", idRem: 13 },
  { lookupId: 17, title: "Missing component", idRem: 17 },
];

/** Build a mock entry, deriving Title the same way the real write path does. */
function entry(
  partial: Omit<TeradyneLogEntry, "title" | "createdAt" | "modifiedAt"> & {
    createdAt?: Date;
    modifiedAt?: Date;
  },
): TeradyneLogEntry {
  return {
    ...partial,
    title: buildTeradyneLogTitle(partial.product?.title, partial.defectiveParts),
    createdAt: partial.createdAt ?? new Date("2026-02-17T14:02:00Z"),
    modifiedAt: partial.modifiedAt ?? new Date("2026-02-17T14:02:00Z"),
  };
}

const ref = (list: { lookupId: number; title: string }[], lookupId: number) => {
  const found = list.find((x) => x.lookupId === lookupId);
  return found ? { lookupId: found.lookupId, title: found.title } : null;
};

export const MOCK_TERADYNE_LOG: TeradyneLogEntry[] = [
  entry({
    id: 4801,
    enterDate: new Date("2026-02-27T12:00:00Z"),
    product: ref(MOCK_TERADYNE_PRODUCTS, 214),
    employee1: ref(MOCK_TERADYNE_EMPLOYEES, 5),
    employee2: null,
    remark: ref(MOCK_TERADYNE_REMARKS, 13),
    employee1Clock: 189,
    employee2Clock: null,
    defectiveParts: "CH2 601413",
    numberOfBoards: 1,
    boardsTested: 12,
    failuresPerBoard: 1,
    sapNumber: "601413",
    oldSapNumber: "",
    operatorNotes: "Reading 4.2V on CH2, spec is 5V ±0.25.",
  }),
  entry({
    id: 4800,
    enterDate: new Date("2026-02-24T12:00:00Z"),
    product: ref(MOCK_TERADYNE_PRODUCTS, 208),
    employee1: ref(MOCK_TERADYNE_EMPLOYEES, 14),
    employee2: ref(MOCK_TERADYNE_EMPLOYEES, 11),
    remark: ref(MOCK_TERADYNE_REMARKS, 1),
    employee1Clock: 176,
    employee2Clock: 241,
    defectiveParts: "J4 pins 3-4",
    numberOfBoards: 2,
    boardsTested: 40,
    failuresPerBoard: 1,
    sapNumber: "672337",
    oldSapNumber: "672337-1",
    operatorNotes: "Both boards from the same reflow run.",
  }),
  entry({
    id: 4799,
    enterDate: new Date("2026-02-17T12:00:00Z"),
    product: ref(MOCK_TERADYNE_PRODUCTS, 201),
    employee1: ref(MOCK_TERADYNE_EMPLOYEES, 8),
    employee2: null,
    remark: ref(MOCK_TERADYNE_REMARKS, 4),
    employee1Clock: 88,
    employee2Clock: null,
    defectiveParts: "U1",
    numberOfBoards: 1,
    boardsTested: 8,
    failuresPerBoard: 1,
    sapNumber: "",
    oldSapNumber: "",
    operatorNotes: "",
  }),
  entry({
    id: 4798,
    enterDate: new Date("2026-02-17T12:00:00Z"),
    product: ref(MOCK_TERADYNE_PRODUCTS, 160),
    employee1: null,
    employee2: null,
    remark: ref(MOCK_TERADYNE_REMARKS, 4),
    employee1Clock: null,
    employee2Clock: null,
    defectiveParts: "R1A - via",
    numberOfBoards: 3,
    boardsTested: 30,
    failuresPerBoard: 1,
    sapNumber: "",
    oldSapNumber: "",
    operatorNotes: "Via lifted on rework.",
  }),
  entry({
    id: 4797,
    enterDate: new Date("2026-02-10T12:00:00Z"),
    product: ref(MOCK_TERADYNE_PRODUCTS, 219),
    employee1: ref(MOCK_TERADYNE_EMPLOYEES, 2),
    employee2: null,
    remark: ref(MOCK_TERADYNE_REMARKS, 17),
    employee1Clock: 312,
    employee2Clock: null,
    defectiveParts: "C14",
    numberOfBoards: 1,
    boardsTested: 25,
    failuresPerBoard: 1,
    sapNumber: "594120",
    oldSapNumber: "",
    operatorNotes: "",
  }),
];
