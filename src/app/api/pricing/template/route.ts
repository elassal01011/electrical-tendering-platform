import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { PRICING_TEMPLATE_HEADERS } from "@/lib/services/pricing/pricingImport";

export const runtime = "nodejs";

/** Downloads the canonical import layout shown on the Supplier Pricing screen. */
export async function GET() {
  const guard = await requirePermission("pricing.view");
  if (guard.error) return guard.error;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pricing Import");
  sheet.addRow(PRICING_TEMPLATE_HEADERS);
  sheet.addRow([
    "Example Supplier",
    "SUP-001",
    "Example Manufacturer",
    "PART-001",
    "Optional description",
    "EA",
    "EGP",
    125.5,
    new Date(),
    "",
    "true",
    "Optional source",
  ]);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = PRICING_TEMPLATE_HEADERS.map((header, index) => ({
    header,
    width: index === 4 || index === 11 ? 24 : 20,
  }));
  sheet.getColumn(8).numFmt = "#,##0.00";
  sheet.getColumn(9).numFmt = "yyyy-mm-dd";
  sheet.getColumn(10).numFmt = "yyyy-mm-dd";
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="Pricing Import Template.xlsx"',
    },
  });
}
