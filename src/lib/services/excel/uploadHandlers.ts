import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import {
  EXCEL_CHUNK_BYTES,
  excelUploadLimitMB,
  validateExcelFile,
  ExcelError,
} from "@/lib/services/excel/uploadPolicy";
export function excelUploadHandlers(permission: string) {
  async function GET() {
    try {
      const guard = await requirePermission(permission);
      if (guard.error) return guard.error;
      return NextResponse.json({
        maxUploadMB: excelUploadLimitMB(),
        chunkBytes: EXCEL_CHUNK_BYTES,
      });
    } catch (error) {
      return apiError(error, "excel.upload.policy");
    }
  }
  async function POST(req: NextRequest) {
    try {
      const guard = await requirePermission(permission);
      if (guard.error) return guard.error;
      const input = z
        .object({
          name: z.string().min(1).max(255),
          type: z.string().max(150),
          size: z.number().int().positive(),
        })
        .parse(await req.json());
      validateExcelFile(input);
      const upload = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${guard.userId!}))`;
        await tx.excelUpload.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        if (
          (await tx.excelUpload.count({
            where: { userId: guard.userId!, importedBoqId: null },
          })) >= 3
        )
          throw new ExcelError(
            "Too many active uploads. Clear a selected file or wait 30 minutes.",
            429,
          );
        return tx.excelUpload.create({
          data: {
            userId: guard.userId!,
            fileName: input.name,
            mimeType: input.type,
            size: input.size,
            expiresAt: new Date(Date.now() + 30 * 60000),
          },
        });
      });
      return NextResponse.json(
        { uploadId: upload.id, chunkBytes: EXCEL_CHUNK_BYTES },
        { status: 201 },
      );
    } catch (error) {
      return apiError(error, "excel.upload.create");
    }
  }
  async function PUT(req: NextRequest) {
    try {
      const guard = await requirePermission(permission);
      if (guard.error) return guard.error;
      const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "",
        index = Number(req.nextUrl.searchParams.get("index"));
      if (Number(req.headers.get("content-length")) > EXCEL_CHUNK_BYTES)
        throw new ExcelError("Upload chunk is too large.", 413);
      const reader = req.body?.getReader();
      if (!reader) throw new ExcelError("Upload chunk is missing.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > EXCEL_CHUNK_BYTES) {
          await reader.cancel();
          throw new ExcelError("Upload chunk is too large.", 413);
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uploadId}))`;
        const upload = await tx.excelUpload.findFirst({
          where: {
            id: uploadId,
            userId: guard.userId!,
            expiresAt: { gt: new Date() },
            importedBoqId: null,
          },
        });
        if (!upload)
          throw new ExcelError("Upload expired or was not found.", 404);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= Math.ceil(upload.size / EXCEL_CHUNK_BYTES) ||
          bytes.length !==
            Math.min(EXCEL_CHUNK_BYTES, upload.size - index * EXCEL_CHUNK_BYTES)
        )
          throw new ExcelError("Invalid upload chunk. Select the file again.");
        await tx.excelUploadChunk.upsert({
          where: { uploadId_index: { uploadId, index } },
          create: { uploadId, index, bytes },
          update: { bytes },
        });
      });
      return NextResponse.json({ received: bytes.length });
    } catch (error) {
      return apiError(error, "excel.upload.chunk");
    }
  }
  async function DELETE(req: NextRequest) {
    try {
      const guard = await requirePermission(permission);
      if (guard.error) return guard.error;
      await prisma.excelUpload.deleteMany({
        where: {
          id: req.nextUrl.searchParams.get("uploadId") ?? "",
          userId: guard.userId,
        },
      });
      return NextResponse.json({ deleted: true });
    } catch (error) {
      return apiError(error, "excel.upload.delete");
    }
  }

  return { GET, POST, PUT, DELETE };
}
