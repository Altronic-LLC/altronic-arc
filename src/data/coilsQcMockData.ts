import type { CoilDefectLogEntry } from "@/lib/coilsQc";

export const COILS_QC_MOCK_ENTRIES: CoilDefectLogEntry[] = [
  {
    id: "1",
    coilPartNumber: "692140-1",
    date: "2026-08-31T12:00:00Z",
    produced: 24,
    failed: 2,
    defects: {
      EndcapGapAlignment: 1,
      ErraticVoltage: 0,
      HighPotting: 0,
      HighSecondaryResistance: 0,
      HighPressure: 0,
      LowPotting: 0,
      LowVoltageOutput: 0,
      LeakFromLid: 0,
      OpenSecondary: 0,
      GluedtoPallet: 0,
      LeakinTower: 0,
      Other: 1,
      MisPour: 0,
    },
    otherFaultTable: '[{"fault":"Cosmetic damage","comment":"Scratch on tower"}]',
  },
];