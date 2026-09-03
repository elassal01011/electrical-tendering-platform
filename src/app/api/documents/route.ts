import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { validateZip } from "@/lib/services/excel/readWorkbook";
export const runtime = "nodejs";
const categories = [
  "Tender Documents",
  "Drawings",
  "Specifications",
  "BOQ",
  "Vendor Offers",
  "Datasheets",
  "Technical Submittals",
  "Commercial Offers",
  "Contracts",
] as const;
export async function GET(req: NextRequest) {
  try {
    const g = await requirePermission("document.view");
    if (g.error) return g.error;
    const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
    const [rows, projects] = await Promise.all([
      prisma.document.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          project: { select: { code: true, name: true } },
          category: true,
          fileName: true,
          version: true,
          description: true,
          uploadedBy: true,
          createdAt: true,
        },
        orderBy: [{ fileName: "asc" }, { version: "desc" }],
        take: 100,
      }),
      prisma.project.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, name: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return NextResponse.json({ rows, projects });
  } catch (e) {
    return apiError(e, "documents.list");
  }
}
export async function POST(req: NextRequest) {
  try {
    const g = await requirePermission("document.upload");
    if (g.error) return g.error;
    const form = await req.formData(),
      file = form.get("file");
    if (!file || typeof file === "string")
      throw new ExcelError("Choose a document.");
    if (file.size > 3 * 1024 * 1024)
      throw new ExcelError("Documents must be 3 MB or smaller.", 413);
    if (file.size === 0) throw new ExcelError("Document is empty.");
    const data = z
      .object({
        projectId: z.string().min(1),
        category: z.enum(categories),
        description: z.string().max(2000),
      })
      .parse(
        Object.fromEntries(
          ["projectId", "category", "description"].map((k) => [
            k,
            form.get(k) || "",
          ]),
        ),
      );
    const name = file.name.replace(/[\\/\r\n]/g, "_").slice(0, 200),
      ext = name.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    if (
      !ext ||
      !types[ext] ||
      (file.type &&
        file.type !== types[ext] &&
        file.type !== "application/octet-stream")
    )
      throw new ExcelError(
        "Supported documents: PDF, PNG, JPEG, XLSX and DOCX.",
        415,
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    const valid =
      ext === "pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : ext === "png"
          ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          : ["jpg", "jpeg"].includes(ext)
            ? bytes[0] === 255 && bytes[1] === 216
            : bytes[0] === 80 && bytes[1] === 75;
    if (!valid)
      throw new ExcelError(
        "Document content does not match its file extension.",
      );
    if (["xlsx", "docx"].includes(ext)) validateZip(bytes);
    const doc = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.projectId + ":" + name}))`;
      await tx.project.findFirstOrThrow({
        where: { id: data.projectId, deletedAt: null },
      });
      const previous = await tx.document.findFirst({
        where: { projectId: data.projectId, fileName: name },
        orderBy: { version: "desc" },
      });
      const document = await tx.document.create({
        data: {
          ...data,
          fileName: name,
          bytes,
          mimeType: types[ext!],
          storageKey: "DATABASE",
          uploadedBy: g.userId!,
          version: (previous?.version || 0) + 1,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "DOCUMENT_UPLOADED",
          entity: "Project",
          entityId: data.projectId,
          newValue: {
            documentId: document.id,
            fileName: name,
            version: document.version,
          },
        },
      });
      return document;
    });
    return NextResponse.json(
      { id: doc.id, version: doc.version },
      { status: 201 },
    );
  } catch (e) {
    return apiError(e, "documents.upload");
  }
}
