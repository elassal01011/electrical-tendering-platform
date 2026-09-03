import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";

/**
 * GET /api/export/excel?panelId=... — generates the "Panel BOM" export
 * (spec Section 29, item 6). Other export types listed in the spec
 * (internal priced BOQ, client unpriced BOQ, supplier RFQ, procurement
 * list, quote summary) share this same ExcelJS setup and are a direct
 * extension of this route — not built out in this pass.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("pricing.view");
  if (guard.error) return guard.error;

  const { searchParams } = new URL(req.url);
  const panelId = searchParams.get("panelId");
  if (!panelId)
    return NextResponse.json({ error: "panelId is required" }, { status: 400 });

  const panel = await prisma.panel.findUnique({
    where: { id: panelId },
    include: { components: { include: { component: true } }, project: true },
  });
  if (!panel)
    return NextResponse.json({ error: "Panel not found" }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "E-SOLUTIONS";
  const sheet = workbook.addWorksheet("Panel BOM");

  sheet.columns = [
    { header: "Line", key: "line", width: 6 },
    { header: "Manufacturer", key: "manufacturer", width: 20 },
    { header: "Part Number", key: "partNumber", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "Qty", key: "qty", width: 8 },
    { header: "Unit List Price", key: "listPrice", width: 16 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Line Total (List)", key: "lineTotal", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  panel.components.forEach((pc, idx) => {
    const listPrice = pc.component.listPrice
      ? Number(pc.component.listPrice)
      : 0;
    sheet.addRow({
      line: idx + 1,
      manufacturer: pc.component.manufacturer,
      partNumber: pc.component.partNumber,
      description: pc.component.description,
      qty: Number(pc.quantity),
      listPrice,
      currency: pc.component.listPriceCurrency,
      lineTotal: listPrice * Number(pc.quantity),
    });
  });

  sheet.autoFilter = { from: "A1", to: "H1" };

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${panel.code}-BOM.xlsx"`,
    },
  });
}
