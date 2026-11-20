// =============================================================================
// The fifteen inspection checks on the GE controller log sheets — word for
// word the same on GET-1 Rev 3 (GE ECU) and QCFRM-035 Rev 0 (Series X), so
// both forms read them from here, with the same SharePoint column names.
//
// If one form's revision changes a line, give that form its own copy rather
// than editing this one: the other form's paper hasn't changed.
// =============================================================================

/** The checks, in the paper's order: key, column, the paper's wording. */
export const QC_GE_CONTROLLER_CHECKS: ReadonlyArray<readonly [key: string, column: string, label: string]> = [
  ["pinInspection", "PinInspection", "100% Inspection of Pins (Using Tool)"],
  ["connectorLabelsScrews", "ConnectorLabelsScrews", "Verify Connector Labels and Connector Screws are present and tightened"],
  ["connectorKeyway", "ConnectorKeyway", "Verify Connector key-way orientation"],
  ["heatsinkScrewsSealant", "HeatsinkScrewsSealant", "Verify (5) five screws on heatsink and heatsink sealant is there with no excess material"],
  ["mountingScrews", "MountingScrews", "Verify ten (10) mounting screws are present, tightened, & torqued"],
  ["groundStrap", "GroundStrap", "Verify ground strap is installed correctly (orientation) with star washer"],
  ["plateScrews", "PlateScrews", "Verify top/bottom plate each have six (6) screws installed, tightened, & torqued"],
  ["mountingPlateOrientation", "MountingPlateOrientation", "Verify correct orientation of the mounting plate"],
  ["usbSocket", "UsbSocket", "Using USB Stick, test USB Socket to insure it does not rotate/push in"],
  ["usbDustCover", "UsbDustCover", "Verify dust cover is installed over USB Socket"],
  ["serialNumberLabels", "SerialNumberLabels", "Verify (2) serial numbers are installed in proper location and orientation"],
  ["frameOrder", "FrameOrder", "Verify that frames are in correct order (see print or reference photo)"],
  ["frameEtching", "FrameEtching", "Verify that frames are etched correctly (see print or reference photo)"],
  ["protectiveCaps", "ProtectiveCaps", "Install protective caps on each connector using the photo with P/N’s as reference"],
  ["shipFirmwareVerified", "ShipFirmwareVerified", "Verify Ship Firmware Revision on PC"],
];
