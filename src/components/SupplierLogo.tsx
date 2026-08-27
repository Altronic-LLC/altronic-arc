import { Truck } from "lucide-react";
import type { SupplierLogoRef } from "@/types/task";
import { useAttachmentBlobUrl, useAttachments } from "@/hooks/useAttachments";
import { cn } from "@/lib/cn";

interface SupplierLogoProps {
  supplierId: number;
  logo: SupplierLogoRef | null;
  className?: string;
}

/**
 * A supplier's Logo — a modern SharePoint "Image" column that stores no
 * binary of its own. The `Logo` field is JSON metadata naming a reserved
 * (hidden) attachment on the same item; this resolves that name against the
 * item's real attachment list (the same `useAttachments("supplier", id)`
 * AttachmentsSection reads, so no extra LIST request) and renders whichever
 * one matches by filename.
 *
 * The image itself is loaded via `useAttachmentBlobUrl`, NOT a bare
 * `<img src={file.downloadUrl}>` — a plain SharePoint URL 401s from an
 * `<img>` fetch (no Authorization header, no session cookie) and renders a
 * broken-image icon. Confirmed live, 2026-08-26. See the hook's doc comment.
 *
 * Falls back to a plain icon tile whenever there's nothing to show: no Logo
 * value, the attachments list hasn't loaded yet, no matching attachment
 * found, or the authenticated fetch itself failed. A missing logo is never
 * an error state; most suppliers don't have one.
 */
export function SupplierLogo({ supplierId, logo, className }: SupplierLogoProps) {
  // Only fetches when there's a logo to look for — most suppliers have none,
  // and the list view never renders this at all (531 rows; one attachment
  // fetch per row would be its own performance problem).
  const { data: attachments } = useAttachments("supplier", logo ? supplierId : null);
  const file = logo ? attachments?.find((a) => a.fileName === logo.fileName) : undefined;
  const { data: blobUrl } = useAttachmentBlobUrl("supplier", file ? supplierId : undefined, file?.fileName);

  if (blobUrl) {
    return (
      <img
        src={blobUrl}
        alt={logo?.originalImageName || "Supplier logo"}
        className={cn("h-10 w-10 rounded-md border border-border object-contain bg-white p-1", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md bg-cooper-red/10 text-cooper-red",
        className,
      )}
    >
      <Truck className="h-5 w-5" />
    </span>
  );
}
