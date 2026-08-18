import type { PottingSampleEntry, PottingLimits, PsrNotificationPerson } from "@/lib/pottingSampleLog";

// Sample rows drawn from Coil-PottingSampleLog.csv (most recent first).
export const POTTING_SAMPLE_MOCK_ENTRIES: PottingSampleEntry[] = [
  { id: "153", date: "2026-08-12T14:31:00", volume: 125, weight: 174 },
  { id: "152", date: "2026-08-11T17:08:00", volume: 125, weight: 174 },
  { id: "151", date: "2026-08-10T19:03:00", volume: 125, weight: 174 },
  { id: "149", date: "2026-05-21T13:49:00", volume: 125, weight: 179 },
  { id: "143", date: "2026-05-20T15:49:00", volume: 125, weight: 175 },
  { id: "148", date: "2026-05-20T08:36:00", volume: 125, weight: 176 },
  { id: "147", date: "2026-05-19T15:18:00", volume: 125, weight: 179 },
  { id: "146", date: "2026-05-18T15:24:00", volume: 125, weight: 179 },
  { id: "145", date: "2026-05-15T12:04:00", volume: 125, weight: 179 },
  { id: "144", date: "2026-05-14T16:16:00", volume: 125, weight: 175 },
  { id: "142", date: "2026-05-12T17:38:00", volume: 125, weight: 179 },
  { id: "141", date: "2026-05-11T16:20:00", volume: 125, weight: 179 },
  { id: "140", date: "2026-05-10T20:42:00", volume: 125, weight: 177 },
  { id: "139", date: "2026-05-09T10:09:00", volume: 125, weight: 178 },
  { id: "138", date: "2026-05-08T13:44:00", volume: 125, weight: 176 },
  { id: "131", date: "2026-05-01T12:03:00", volume: 125, weight: 119 },
  { id: "130", date: "2026-05-01T12:03:00", volume: 125, weight: 169 },
];

export const POTTING_LIMIT_MOCK: PottingLimits = {
  lowerLimit: 173,
  upperLimit: 180,
};

export const PSR_NOTIFICATION_MOCK: PsrNotificationPerson[] = [
  { id: "1", displayName: "Jennifer Sankey", email: "Jennifer.Sankey@altronic-llc.com" },
  { id: "2", displayName: "Rodney Pugh", email: "Rodney.Pugh@altronic-llc.com" },
  { id: "3", displayName: "Buddy Fares", email: "Buddy.Fares@altronic-llc.com" },
  { id: "4", displayName: "Thomas Westbrook", email: "Thomas.Westbrook@altronic-llc.com" },
  { id: "5", displayName: "David Bulkley", email: "David.Bulkley@altronic-llc.com" },
  { id: "6", displayName: "Eric Gilkinson", email: "Eric.Gilkinson@altronic-llc.com" },
  { id: "7", displayName: "Tim Webster", email: "Tim.Webster@altronic-llc.com" },
];
