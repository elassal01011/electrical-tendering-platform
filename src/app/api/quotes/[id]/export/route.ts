import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import {
  commercialTotals,
  customerQuote,
} from "@/lib/services/quotes/commercial";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const internal = req.nextUrl.searchParams.get("view") === "internal";
    const g = await requirePermission(
      internal ? "quote.cost.view" : "quote.view",
    );
    if (g.error) return g.error;
    const q = await prisma.quote.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        items: true,
        project: { include: { client: true, consultant: true } },
      },
    });
    const commercial = customerQuote(q);
    const company = commercial.company;
    const wb = new ExcelJS.Workbook();
    wb.creator = company?.companyName || "E-SOLUTIONS";
    const sheet = wb.addWorksheet(
      internal ? "Internal cost sheet" : "Commercial quotation",
    );
    sheet.addRow([
      company?.companyName,
      q.quoteNumber,
      "Revision " + q.revision,
    ]);
    sheet.addRow([q.project.client.companyName, q.project.name, q.currency]);
    sheet.addRow([
      q.status,
      q.validUntil
        ? "Valid until " + q.validUntil.toISOString().slice(0, 10)
        : "",
    ]);
    sheet.addRow([]);
    sheet.addRow([
      "Description",
      "Manufacturer",
      "Part number",
      "Qty",
      "Unit",
      ...(internal ? ["Unit cost", "Price source", "Total cost"] : []),
      "Unit sell",
      "Line total",
    ]);
    q.items.forEach((i) =>
      sheet.addRow([
        i.description,
        i.manufacturer,
        i.partNumber,
        Number(i.quantity),
        i.unit,
        ...(internal
          ? [
              Number(i.unitCost),
              i.priceSource || "UNSPECIFIED",
              Number(i.quantity) * Number(i.unitCost),
            ]
          : []),
        Number(i.unitSell),
        Number(i.lineTotal),
      ]),
    );
    const t = commercialTotals(
      q.items.map((i) => ({
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
        unitSell: Number(i.unitSell),
      })),
      Number(q.discountPct),
      Number(q.vatPct),
    );
    sheet.addRow([]);
    for (const [label, value] of Object.entries({
      Subtotal: t.subtotal,
      Discount: t.discount,
      VAT: t.vat,
      "Grand total": t.grandTotal,
      ...(internal
        ? {
            "Total cost": t.totalCost,
            "Gross profit": t.profit,
            "Gross margin %": t.marginPct,
          }
        : {}),
    }))
      sheet.addRow([label, value]);
    for (const [key, value] of Object.entries(commercial.terms))
      sheet.addRow([key, String(value)]);
    sheet.columns.forEach((c, i) => (c.width = i === 0 ? 55 : 20));
    sheet.getRow(5).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 5 }];
    const bytes = await wb.xlsx.writeBuffer();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="' +
          q.quoteNumber.replace(/[^a-zA-Z0-9-]/g, "_") +
          "-R" +
          q.revision +
          (internal ? "-internal" : "") +
          '.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e, "quotes.export");
  }
}
