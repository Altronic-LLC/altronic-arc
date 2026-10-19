// =============================================================================
// Photos taken with a phone or iPad camera from inside ARC (BusinessIT#48).
//
// An iPhone hands every camera shot to the browser as "image.jpg", whatever
// the time, so a folder of photos taken in ARC would read image.jpg,
// image 1.jpg, image 2.jpg … Every photo from the camera button is therefore
// renamed to when it was taken — "Photo 2026-10-19 14-52-03.jpg" — in the
// device's own time. Several from one capture get " (2)", " (3)". A name that
// still clashes in SharePoint is renamed there, never overwritten.
// =============================================================================

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-19 14-52-03", local time. Colons aren't allowed in a SharePoint name. */
export function photoTimestamp(at: Date): string {
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  );
}

/** The file's extension, lower-cased, from its name or failing that its type; "jpg" when neither says. */
export function photoExtension(file: { name: string; type: string }): string {
  const dot = file.name.lastIndexOf(".");
  if (dot > 0 && dot < file.name.length - 1) return file.name.slice(dot + 1).toLowerCase();
  const sub = file.type.startsWith("image/") ? file.type.slice(6).toLowerCase() : "";
  if (sub === "jpeg" || sub === "") return "jpg";
  return sub.replace(/[^a-z0-9]/g, "") || "jpg";
}

/** The name a camera photo is saved under. `index` is its place in one capture (0-based). */
export function cameraPhotoName(file: { name: string; type: string }, at: Date, index = 0): string {
  const suffix = index > 0 ? ` (${index + 1})` : "";
  return `Photo ${photoTimestamp(at)}${suffix}.${photoExtension(file)}`;
}

/** Copies of the camera's files under their new names — the bytes are untouched. */
export function renameCameraPhotos(files: File[], at: Date): File[] {
  return files.map(
    (f, i) => new File([f], cameraPhotoName(f, at, i), { type: f.type || "image/jpeg", lastModified: f.lastModified }),
  );
}
