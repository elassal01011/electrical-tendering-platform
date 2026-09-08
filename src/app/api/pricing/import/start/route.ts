import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { publicCatalogSession } from "@/lib/services/pricing/catalogSession";
import {
  mergeCatalogSession,
  readCatalogSession,
} from "@/lib/services/pricing/catalogSessionStore";
import { apiError } from "@/lib/apiError";

export async function POST(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const { uploadId } = await req.json();
    const id = typeof uploadId === "string" ? uploadId : "";
    const session = await readCatalogSession(prisma, id, guard.userId!);
    if (!session)
      return NextResponse.json(
        { error: "Import session not found." },
        { status: 404 },
      );
    if (session.status === "CANCELLED")
      return NextResponse.json(
        { error: "This import was cancelled." },
        { status: 409 },
      );
    if (session.status === "READY" || session.status === "FAILED") {
      session.status = "IMPORTING";
      session.lastError = undefined;
      session.updatedAt = new Date().toISOString();
      await mergeCatalogSession(prisma, id, guard.userId!, {
        status: session.status,
        updatedAt: session.updatedAt,
        lastError: null,
      });
    }
    return NextResponse.json(publicCatalogSession(id, session));
  } catch (error) {
    return apiError(error, "pricing.import.start");
  }
}
