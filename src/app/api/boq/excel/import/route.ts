import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
const schema = z.object({ projectId: z.string().min(1), name: z.string().min(1), sheetName: z.string().min(1), headerRow: z.number().int().positive(), mapping: z.record(z.string(), z.number().int().positive()) });
const value = (cell: ExcelJS.Cell) => cell.text.trim();

export async function POST(req: NextRequest) {
  const guard = await requirePermission("boq.import"); if (guard.error) return guard.error;
  const form = await req.formData(); const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Excel file is required" }, { status: 400 });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(JSON.parse(String(form.get("config")))); } catch (error) { return NextResponse.json({ error: "Invalid import configuration", detail: error instanceof Error ? error.message : undefined }, { status: 400 }); }
  if (!input.mapping.description || !input.mapping.quantity) return NextResponse.json({ error: "Description and quantity mappings are required" }, { status: 400 });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await file.arrayBuffer())); const ws = wb.getWorksheet(input.sheetName);
  if (!ws) return NextResponse.json({ error: "Selected sheet no longer exists" }, { status: 400 });
  const items: Prisma.BOQItemCreateWithoutBoqInput[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= input.headerRow) return;
    const description = value(row.getCell(input.mapping.description)); const quantityText = value(row.getCell(input.mapping.quantity));
    const quantity = Number(quantityText.replace(/,/g, "")); const itemNumber = input.mapping.itemNumber ? value(row.getCell(input.mapping.itemNumber)) : "";
    const hasDescription = description.length > 0; const isSectionHeader = hasDescription && (!quantityText || !Number.isFinite(quantity) || quantity <= 0);
    if (!hasDescription || isSectionHeader) return;
    items.push({ lineNo: items.length + 1, originalRowNumber: rowNumber, itemNumber: itemNumber || null, rawDescription: description, quantity, unit: input.mapping.unit ? value(row.getCell(input.mapping.unit)) || "NO" : "NO", manufacturerRequirement: input.mapping.manufacturer ? value(row.getCell(input.mapping.manufacturer)) || null : null, modelRequirement: input.mapping.model ? value(row.getCell(input.mapping.model)) || null : null, remarks: input.mapping.remarks ? value(row.getCell(input.mapping.remarks)) || null : null, parsedSpec: parseBoqDescription(description) as unknown as Prisma.InputJsonValue, status: "UNMATCHED" });
  });
  if (!items.length) return NextResponse.json({ error: "No importable BOQ rows found. Check the header row and mappings." }, { status: 400 });
  const boq = await prisma.bOQ.create({ data: { projectId: input.projectId, name: input.name, sourceType: "EXCEL_IMPORT", items: { create: items }, excelImports: { create: { fileName: file.name, sheetName: input.sheetName, headerRow: input.headerRow, mapping: input.mapping, importedRows: items.length, createdBy: guard.userId } } }, include: { items: true } });
  await writeAuditLog({ userId: guard.userId, action: "BOQ_IMPORTED", entity: "BOQ", entityId: boq.id, newValue: { fileName: file.name, sheetName: input.sheetName, rowCount: items.length } });
  return NextResponse.json({ boq }, { status: 201 });
}
