import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PhotoSize } from "@/api/driveLibrary";
import type { DriveEntry } from "@/api/projectFiles";

// =============================================================================
// One picture for the photo gallery (Application Photos, 2026-11-24) — a tile's
// thumbnail or the preview's larger image — as an object URL.
//
// The bytes are fetched by the library (thumbnail first, the file itself as a
// fallback) and cached per item, size and modified time, so a renamed or
// re-uploaded photo is fetched again and scrolling back is free. The object
// URL is made per mount and revoked on unmount, so nothing leaks.
// =============================================================================

export type PhotoLoader = (itemId: string, name: string, size: PhotoSize) => Promise<Blob>;

export function useDrivePhoto(
  keyPrefix: string,
  loader: PhotoLoader,
  entry: DriveEntry,
  size: PhotoSize,
  enabled: boolean,
): { url: string | null; loading: boolean; failed: boolean } {
  const query = useQuery({
    queryKey: [keyPrefix, "photo", entry.id, size, entry.lastModified.getTime()],
    queryFn: () => loader(entry.id, entry.name, size),
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data || typeof URL.createObjectURL !== "function") {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { url, loading: enabled && query.isPending, failed: query.isError };
}

/**
 * Has this element come near the screen? A gallery asks for a tile's picture
 * only then, so a folder of 300 photos doesn't fetch 300 at once. Without
 * IntersectionObserver (old browsers, tests) everything counts as visible.
 */
export function useNearScreen<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, seen]);
  return [setEl, seen];
}
