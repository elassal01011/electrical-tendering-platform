import { prisma } from "@/lib/db/prisma";
import { EXCEL_CHUNK_BYTES, ExcelError } from "./uploadPolicy";
export async function storedWorkbook(uploadId: string, userId: string) {
  const upload = await prisma.excelUpload.findFirst({
    where: { id: uploadId, userId, expiresAt: { gt: new Date() } },
    include: { chunks: { orderBy: { index: "asc" } } },
  });
  if (!upload)
    throw new ExcelError(
      "Upload expired or was not found. Select the file again.",
      404,
    );
  if (
    upload.chunks.length !== Math.ceil(upload.size / EXCEL_CHUNK_BYTES) ||
    upload.chunks.some((chunk, i) => chunk.index !== i)
  )
    throw new ExcelError(
      "Upload is incomplete. Please upload the workbook again.",
    );
  const bytes = Buffer.concat(upload.chunks.map((c) => c.bytes));
  if (bytes.length !== upload.size)
    throw new ExcelError(
      "Upload is incomplete. Please upload the workbook again.",
    );
  return {
    name: upload.fileName,
    type: upload.mimeType,
    size: upload.size,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}
export async function workbookRequest(req: Request, userId: string) {
  if (req.headers.get("content-type")?.includes("application/json")) {
    const input = await req.json();
    if (typeof input.uploadId !== "string")
      throw new ExcelError("Upload ID is required.");
    return {
      file: await storedWorkbook(input.uploadId, userId),
      config: input.config ?? {},
      uploadId: input.uploadId as string,
    };
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string")
    throw new ExcelError("Excel file is required.");
  const config = form.get("config")
    ? JSON.parse(String(form.get("config")))
    : {
        sheetName: form.get("sheetName") || undefined,
        headerRow: form.get("headerRow")
          ? Number(form.get("headerRow"))
          : undefined,
      };
  return { file, config, uploadId: undefined };
}
