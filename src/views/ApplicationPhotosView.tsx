import {
  APPLICATION_PHOTOS_FOLDER_URL,
  applicationPhotoImage,
  downloadApplicationPhoto,
} from "@/api/applicationPhotos";
import { applicationPhotosHooks } from "@/hooks/useApplicationPhotos";
import { DriveLibraryView } from "./DriveLibraryView";

// Application Photos (BusinessIT#48) — General/A-Application Photos in the
// ALTRONICSALESTEAM Documents library, a storehouse for pictures. All
// behaviour lives in DriveLibraryView; `takePhoto` adds the camera button on
// a phone or iPad, and `gallery` shows the folder as photo tiles with a
// preview before opening (Ray, 2026-11-24).

export function ApplicationPhotosView() {
  return (
    <DriveLibraryView
      title="Application Photos"
      description="The Sales team's photo storehouse (Documents › General › A-Application Photos) — browse the photos, preview one before opening it, add or take photos, create subfolders, download, rename and delete."
      category="Sales"
      listTo="/"
      basePath="/sales/application-photos"
      rootName="Application Photos"
      rootWebUrl={APPLICATION_PHOTOS_FOLDER_URL}
      accessList="The Application Photos folder"
      accessSite="ALTRONICSALESTEAM"
      recycleBinOwner="the ALTRONICSALESTEAM site's"
      fileInputTestId="application-photos-file-input"
      hooks={applicationPhotosHooks}
      download={downloadApplicationPhoto}
      takePhoto
      gallery={{ keyPrefix: "application-photos", photo: applicationPhotoImage }}
    />
  );
}
