import type { QcFormSpec } from "./qcFormEngine";
import { QC_CPU95_FORM } from "./qcCpu95Form";
import { QC_GET1_FORM } from "./qcGet1Form";

// =============================================================================
// QC Forms registry — every digitized form, in the order the landing page
// shows them. `/qc-forms/<id>` renders whichever spec has that id, so adding a
// form is its spec here plus its list in api/qcFormLists.ts; no route, view or
// form component of its own.
// =============================================================================

export const QC_FORMS: readonly QcFormSpec[] = [QC_CPU95_FORM, QC_GET1_FORM];

export function qcFormById(id: string | undefined): QcFormSpec | null {
  return QC_FORMS.find((form) => form.id === id) ?? null;
}
