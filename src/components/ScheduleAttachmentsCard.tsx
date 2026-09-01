import { AttachmentsSection } from "./AttachmentsSection";

// =============================================================================
// Documents on a PM schedule — the manual, not the procedure.
//
// A PM's procedure lives in its Instructions checklist, which is text a
// technician ticks through. The MANUAL behind that procedure is a PDF, and
// before this it had nowhere to live: it was either re-uploaded onto each work
// order the schedule raised (one file, N copies, none of them obviously the
// current one) or it sat in somebody's folder and was found by asking them.
//
// Attaching it to the SCHEDULE gives it one home. Every work order raised off
// the schedule points back at the schedule, so the file is one hop away from
// every occurrence for ever, and replacing it replaces it everywhere at once.
//
// This is a thin wrapper over the shared `AttachmentsSection` — deliberately
// so. That component owns upload, download, delete, drag-and-drop, paste, the
// `Reserved_ImageAttachment_` filter and the "attachments unavailable"
// degradation; a schedule needs none of that reimplemented, only the sentence
// above it saying why the file belongs here rather than on the work order.
// =============================================================================

export interface ScheduleAttachmentsCardProps {
  /** The Scheduled Maintenance list-item id. */
  scheduleId: number;
  /**
   * Optional heading caption override. The default explains the
   * schedule-vs-work-order distinction, which is the whole point of the card;
   * pass `null` to drop it where the surrounding view already says as much.
   */
  caption?: string | null;
}

export const SCHEDULE_ATTACHMENTS_CAPTION =
  "Manuals, instruction sheets and procedure PDFs live on the schedule, not on " +
  "each work order it raises — so there's one copy, and every occurrence points " +
  "back to it.";

/**
 * Attachments card for a single PM schedule.
 *
 * Not wired into a view here — `PmLibraryView` and the schedule form modal
 * drop it in themselves.
 */
export function ScheduleAttachmentsCard({
  scheduleId,
  caption = SCHEDULE_ATTACHMENTS_CAPTION,
}: ScheduleAttachmentsCardProps) {
  return (
    <div className="flex flex-col gap-2">
      {caption != null && caption !== "" && (
        <p className="text-xs leading-relaxed text-fg-muted">{caption}</p>
      )}
      <AttachmentsSection parent="scheduledMaintenance" itemId={scheduleId} />
    </div>
  );
}

export default ScheduleAttachmentsCard;
