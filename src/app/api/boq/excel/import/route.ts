import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { readWorkbook } from "@/lib/services/excel/readWorkbook";
import { analyzeWorkbook } from "@/lib/services/excel/analyzeWorkbook";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { apiError } from "@/lib/apiError";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";
import type { Prisma } from "@prisma/client";
export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  sheetName: z.string().min(1),
  headerRow: z.number().int().positive(),
  mapping: z.record(z.number().int().positive()),
  skipReviewRows: z.boolean().default(false),
});
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission("boq.import");
    if (guard.error) return guard.error;
    const { file, config, uploadId } = await workbookRequest(
      req,
      guard.userId!,
    );
    const input = schema.parse(config);
    const workbook = await readWorkbook(file),
      sheet = workbook.getWorksheet(input.sheetName);
    if (!sheet) throw new ExcelError("Selected sheet no longer exists.");
    const analysis = analyzeWorkbook(sheet, input.headerRow, input.mapping);
    if (analysis.summary.reviewRows && !input.skipReviewRows)
      throw new ExcelError(
        "Some rows require review. Correct the workbook or explicitly confirm skipping them.",
        422,
      );
    if (!analysis.items.length)
      throw new ExcelError(
        "No importable BOQ rows found. Check the header row and mappings.",
      );
    const result = await prisma.$transaction(
      async (tx) => {
        if (uploadId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uploadId}))`;
          const upload = await tx.excelUpload.findFirst({
            where: {
              id: uploadId,
              userId: guard.userId!,
              expiresAt: { gt: new Date() },
            },
          });
          if (!upload)
            throw new ExcelError(
              "Upload expired. Select the workbook again.",
              404,
            );
          if (upload.importedBoqId)
            return { id: upload.importedBoqId, repeated: true };
        }
        const project = await tx.project.findFirst({
          where: { id: input.projectId, deletedAt: null },
        });
        if (!project)
          throw new ExcelError("Selected project was not found.", 404);
        const boq = await tx.bOQ.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            sourceType: "EXCEL_IMPORT",
            excelImports: {
              create: {
                fileName: file.name,
                sheetName: input.sheetName,
                headerRow: input.headerRow,
                mapping: input.mapping,
                importedRows: analysis.items.length,
                createdBy: guard.userId!,
              },
            },
          },
        });
        for (let offset = 0; offset < analysis.items.length; offset += 500) {
          await tx.bOQItem.createMany({
            data: analysis.items.slice(offset, offset + 500).map((row, i) => ({
              boqId: boq.id,
              lineNo: offset + i + 1,
              originalRowNumber: row.rowNumber,
              rawDescription: row.description,
              quantity: row.quantity,
              unit: row.fields.unit || "NO",
              itemNumber: row.fields.itemNumber || null,
              manufacturerRequirement: row.fields.manufacturer || null,
              modelRequirement: row.fields.model || null,
              remarks: row.fields.remarks || null,
              parsedSpec: {
                ...parseBoqDescription(row.description),
                ...(row.fields.manufacturer
                  ? {
                      manufacturer:
                        parseBoqDescription(row.fields.manufacturer)
                          .manufacturer || row.fields.manufacturer,
                    }
                  : {}),
              } as unknown as Prisma.InputJsonValue,
              status: "UNMATCHED",
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            userId: guard.userId,
            action: "BOQ_IMPORTED",
            entity: "BOQ",
            entityId: boq.id,
            newValue: {
              fileName: file.name,
              sheetName: input.sheetName,
              summary: analysis.summary,
              skippedRows: analysis.issues,
            } as Prisma.InputJsonValue,
          },
        });
        if (uploadId)
          await tx.excelUpload.update({
            where: { id: uploadId },
            data: { importedBoqId: boq.id },
          });
        return { id: boq.id, repeated: false };
      },
      { timeout: 45000 },
    );
    const boq = await prisma.bOQ.findUnique({
      where: { id: result.id },
      include: { items: { take: 100, orderBy: { lineNo: "asc" } } },
    });
    return NextResponse.json(
      {
        boq,
        summary: analysis.summary,
        itemCount: analysis.items.length,
        repeated: result.repeated,
      },
      { status: result.repeated ? 200 : 201 },
    );
  } catch (error) {
    return apiError(error, "excel.import");
  }
}
