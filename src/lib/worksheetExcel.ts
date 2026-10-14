import type ExcelJS from "exceljs";
import type { NewProductWorksheet, SubAssembly } from "@/types/pricing";
import { lineUnitCost, priceBreaks, subAssemblyCost, tierRanges, worksheetCost } from "./pricingMath";

// =============================================================================
// One New Product Pricing worksheet as an xlsx (Ray, 2026-10-13) — managers
// and admins only, like the worksheet itself. ExcelJS is INJECTED: the caller
// dynamic-imports it, so the ~950KB library never lands in the main bundle
// (the Open Orders arrangement).
//
// One sheet: the product, each sub-assembly's lines with uploaded and
// adjusted cost side by side, the cost roll-up, and the price with its
// quantity breaks. Real numbers in number-formatted cells, so it sums in Excel.
// =============================================================================

const MONEY = '"$"#,##0.00';
const MONEY4 = '"$"#,##0.00##';
const PCT = '0.0"%"';

export async function buildWorksheetWorkbook(
  excel: typeof ExcelJS,
  ws: NewProductWorksheet,
  subs: SubAssembly[],
): Promise<ArrayBuffer> {
  const wb = new excel.Workbook();
  wb.creator = "Altronic ARC";
  const sheet = wb.addWorksheet(`${ws.worksheetNumber} R${ws.rev}`.slice(0, 31));
  sheet.columns = [
    { width: 20 },
    { width: 18 },
    { width: 42 },
    { width: 10 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
  ];
  const bold = (row: ExcelJS.Row) => {
    row.font = { bold: true };
  };

  bold(sheet.addRow([`${ws.worksheetNumber} — R${ws.rev}`, ws.productName]));
  if (ws.description) sheet.addRow(["Description", ws.description]);
  if (ws.customerName) sheet.addRow(["Customer", `${ws.customerName}${ws.customerSoldTo ? ` (${ws.customerSoldTo})` : ""}`]);
  if (ws.expectedAnnualVolume !== null) sheet.addRow(["Expected annual volume", ws.expectedAnnualVolume]);
  sheet.addRow([]);

  const current = [...subs].filter((s) => s.rev === ws.rev).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const sub of current) {
    bold(
      sheet.addRow([
        sub.kind === "part" ? `Part: ${sub.name}` : sub.name,
        [sub.altronicPartNumber, sub.sapPartNumber].filter(Boolean).join(" / "),
        `× ${sub.quantityPerProduct} per product`,
        "",
        "",
        "",
        "",
        sub.fileName,
      ]),
    );
    bold(sheet.addRow(["Altronic #", "SAP #", "Description", "Qty", "Base cost", "Adjusted cost", "Cost used", "Extended"]));
    for (const line of sub.lines) {
      const used = lineUnitCost(line);
      const row = sheet.addRow([
        line.source === "manual" ? `${line.partNumber} (manual)` : line.source === "sap" ? `${line.partNumber} (SAP)` : line.partNumber,
        line.sapPartNumber ?? "",
        line.description,
        line.quantity,
        line.uploadedCost,
        line.adjustedCost,
        used,
        used === null ? null : used * line.quantity,
      ]);
      [5, 6, 7].forEach((c) => (row.getCell(c).numFmt = MONEY4));
      row.getCell(8).numFmt = MONEY;
    }
    const c = subAssemblyCost(sub);
    const total = sheet.addRow(["", "", `${sub.name} — per one`, "", c.uploaded, "", c.used, ""]);
    bold(total);
    total.getCell(5).numFmt = MONEY;
    total.getCell(7).numFmt = MONEY;
    sheet.addRow([]);
  }

  const cost = worksheetCost(current, ws.overheadPct);
  bold(sheet.addRow(["Cost roll-up", "", "", "", "Base", "", "Used"]));
  const material = sheet.addRow(["Material", "", "Σ sub-assemblies and parts × qty per product", "", cost.material.uploaded, "", cost.material.used]);
  sheet.addRow(["Overhead", "", `${ws.overheadPct}%`]);
  const unit = sheet.addRow(["Unit cost", "", "material × (1 + overhead)", "", cost.unit.uploaded, "", cost.unit.used]);
  for (const r of [material, unit]) {
    r.getCell(5).numFmt = MONEY;
    r.getCell(7).numFmt = MONEY;
  }
  bold(unit);
  sheet.addRow([]);

  bold(sheet.addRow(["Price"]));
  const dist = sheet.addRow(["Distributor discount", `${ws.distributorDiscountPct}% (${ws.discountSource})`]);
  dist.getCell(2).alignment = { horizontal: "left" };
  if (ws.targetGM !== null) sheet.addRow(["Target base GM", `${ws.targetGM}%`]);
  const list = sheet.addRow(["List price", ws.listPrice]);
  list.getCell(2).numFmt = MONEY;
  const gm = sheet.addRow(["Base GM", ws.baseGM]);
  gm.getCell(2).numFmt = PCT;

  if (ws.priceBreaks.length > 0 && ws.listPrice !== null) {
    sheet.addRow([]);
    bold(sheet.addRow(["Quantity", "Price each", "", "Base GM"]));
    const ranges = tierRanges(ws.priceBreaks);
    const tiers = [
      { price: ws.listPrice, baseGM: ws.baseGM },
      ...priceBreaks(ws.listPrice, ws.unitCost, ws.distributorDiscountPct, ws.priceBreaks),
    ];
    tiers.forEach((t, i) => {
      const row = sheet.addRow([ranges[i], t.price, "", t.baseGM]);
      row.getCell(2).numFmt = MONEY;
      row.getCell(4).numFmt = PCT;
    });
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export function worksheetFileName(ws: Pick<NewProductWorksheet, "worksheetNumber" | "rev">): string {
  return `${ws.worksheetNumber}-R${ws.rev}.xlsx`;
}
