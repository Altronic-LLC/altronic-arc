import { describe, expect, it } from "vitest";
import { cameraPhotoName, photoExtension, photoTimestamp, renameCameraPhotos } from "./cameraPhoto";

// The clock is passed in, so no system time is needed.
const AT = new Date(2026, 9, 19, 14, 52, 3); // 19 Oct 2026, 14:52:03 local

describe("camera photo names", () => {
  it("stamps the local time with no colons, which SharePoint refuses", () => {
    expect(photoTimestamp(AT)).toBe("2026-10-19 14-52-03");
    expect(photoTimestamp(new Date(2026, 0, 5, 7, 8, 9))).toBe("2026-01-05 07-08-09");
  });

  it("keeps the extension from the name, else the type, else jpg", () => {
    expect(photoExtension({ name: "image.JPG", type: "image/jpeg" })).toBe("jpg");
    expect(photoExtension({ name: "IMG_0001.HEIC", type: "image/heic" })).toBe("heic");
    expect(photoExtension({ name: "blob", type: "image/png" })).toBe("png");
    expect(photoExtension({ name: "blob", type: "image/jpeg" })).toBe("jpg");
    expect(photoExtension({ name: "", type: "" })).toBe("jpg");
  });

  it("names a photo by when it was taken, numbering a second from the same capture", () => {
    expect(cameraPhotoName({ name: "image.jpg", type: "image/jpeg" }, AT)).toBe("Photo 2026-10-19 14-52-03.jpg");
    expect(cameraPhotoName({ name: "image.jpg", type: "image/jpeg" }, AT, 1)).toBe("Photo 2026-10-19 14-52-03 (2).jpg");
  });

  it("renames the files without touching their contents or type", async () => {
    const [out] = renameCameraPhotos([new File(["pixels"], "image.jpg", { type: "image/jpeg" })], AT);
    expect(out.name).toBe("Photo 2026-10-19 14-52-03.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(await out.text()).toBe("pixels");
  });
});
