import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("document.view");
    if (g.error) return g.error;
    const doc = await prisma.document.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!doc?.bytes)
      return NextResponse.json(
        { error: "Document content is unavailable." },
        { status: 404 },
      );
    return new NextResponse(new Uint8Array(doc.bytes), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(doc.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e, "documents.download");
  }
}
export async function DELETE(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("document.delete");
    if (g.error) return g.error;
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.update({
        where: { id: params.id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "DOCUMENT_DELETED",
          entity: "Project",
          entityId: doc.projectId,
          newValue: {
            documentId: doc.id,
            fileName: doc.fileName,
            version: doc.version,
          },
        },
      });
    });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return apiError(e, "documents.delete");
  }
}
