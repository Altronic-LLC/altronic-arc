// =============================================================================
// QC Forms registry — the landing page (search + a button per form) is built
// from this list. Add a new form here as its own scaffold ships; nothing else
// on the landing page needs to change.
// =============================================================================

export interface QcFormDef {
  /** Route slug, e.g. "cpu-95" → "/qc-forms/cpu-95". */
  id: string;
  /** The controlled-form number, e.g. "QCFRM-012". */
  formNumber: string;
  /** What the form covers, e.g. "CPU-95 Ignition Module". */
  name: string;
  description: string;
  to: string;
}

export const QC_FORMS: QcFormDef[] = [
  {
    id: "cpu-95",
    formNumber: "QCFRM-012",
    name: "CPU-95 Ignition Module",
    description:
      "Electrical test and inspection — covers the CPU-95, CPU-95C, Varispark, and EVS paper variants.",
    to: "/qc-forms/cpu-95",
  },
];
