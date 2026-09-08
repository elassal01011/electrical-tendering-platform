import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { publicCatalogSession } from "@/lib/services/pricing/catalogSession";
import {
  mergeCatalogSession,
  readCatalogSession,
} from "@/lib/services/pricing/catalogSessionStore";
import { apiError } from "@/lib/apiError";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const guard = await requirePermission("pricing.view");
  if (guard.error) return guard.error;
  try {
    const id = (await params).sessionId;
    const session = await readCatalogSession(prisma, id, guard.userId!);
    if (!session)
      return NextResponse.json(
        { error: "Import session not found." },
        { status: 404 },
      );
    return NextResponse.json(publicCatalogSession(id, session));
  } catch (error) {
    return apiError(error, "pricing.import.status");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const id = (await params).sessionId;
    const session = await readCatalogSession(prisma, id, guard.userId!);
    if (!session)
      return NextResponse.json(
        { error: "Import session not found." },
        { status: 404 },
      );
    if (session.leaseToken)
      return NextResponse.json(
        { error: "Wait for the current batch to finish before cancelling." },
        { status: 409 },
      );
    if (session.status !== "COMPLETED") {
      session.status = "CANCELLED";
      session.leaseToken = null;
      session.leaseExpiresAt = null;
      session.updatedAt = new Date().toISOString();
      await mergeCatalogSession(prisma, id, guard.userId!, {
        status: session.status,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: session.updatedAt,
      });
    }
    return NextResponse.json(publicCatalogSession(id, session));
  } catch (error) {
    return apiError(error, "pricing.import.cancel");
  }
}
