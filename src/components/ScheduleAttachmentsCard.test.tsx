import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { uploadAttachment } from "@/api/attachments";
import ScheduleAttachmentsCardDefault, {
  SCHEDULE_ATTACHMENTS_CAPTION,
  ScheduleAttachmentsCard,
} from "./ScheduleAttachmentsCard";

// USE_MOCK is true under Vitest, so api/attachments.ts keeps an in-memory
// store per (parent, itemId) and the card behaves end to end without Graph.

async function settled() {
  await waitFor(() =>
    expect(screen.queryByText(/loading attachments/i)).not.toBeInTheDocument(),
  );
}

describe("ScheduleAttachmentsCard", () => {
  it("renders an empty attachments card for a schedule", async () => {
    renderWithProviders(<ScheduleAttachmentsCard scheduleId={9001} />);
    await settled();
    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
  });

  it("explains that the file belongs to the schedule, not the work order", async () => {
    renderWithProviders(<ScheduleAttachmentsCard scheduleId={9002} />);
    await settled();
    // The reason the card exists at all — a manual attached once to the
    // schedule rather than re-uploaded onto every occurrence.
    expect(screen.getByText(SCHEDULE_ATTACHMENTS_CAPTION)).toBeInTheDocument();
    expect(SCHEDULE_ATTACHMENTS_CAPTION).toMatch(/work order/i);
  });

  it("takes a caption override, and drops it entirely for null", async () => {
    const { unmount } = renderWithProviders(
      <ScheduleAttachmentsCard scheduleId={9003} caption="Bearing kit paperwork." />,
    );
    await settled();
    expect(screen.getByText("Bearing kit paperwork.")).toBeInTheDocument();
    expect(screen.queryByText(SCHEDULE_ATTACHMENTS_CAPTION)).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ScheduleAttachmentsCard scheduleId={9004} caption={null} />);
    await settled();
    expect(screen.queryByText(SCHEDULE_ATTACHMENTS_CAPTION)).not.toBeInTheDocument();
  });

  it("reads the schedule's OWN attachments, not another parent kind's", async () => {
    // Same numeric id on two different parent kinds — the store is keyed by
    // (parent, itemId), so a card pointed at the wrong kind would show the
    // work order's files. That confusion is the one thing worth pinning here:
    // both lists live on the same PMO site.
    await uploadAttachment("maintenanceTask", 9100, new File(["x"], "work-order-photo.jpg"));
    await uploadAttachment("scheduledMaintenance", 9100, new File(["y"], "AJAX-2802-manual.pdf"));

    renderWithProviders(<ScheduleAttachmentsCard scheduleId={9100} />);
    await settled();

    expect(screen.getByText("AJAX-2802-manual.pdf")).toBeInTheDocument();
    expect(screen.queryByText("work-order-photo.jpg")).not.toBeInTheDocument();
  });

  it("is exported both default and named, so either import shape works", () => {
    expect(ScheduleAttachmentsCardDefault).toBe(ScheduleAttachmentsCard);
  });
});
