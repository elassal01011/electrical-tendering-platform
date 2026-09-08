import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/apiError";
import { publicComponentSession } from "@/lib/services/components/componentSession";
import { mergeComponentSession, readComponentSession } from "@/lib/services/components/componentSessionStore";

export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission("catalog.edit");
    if (guard.error) return guard.error;
    const { uploadId } = await req.json();
    let session = await readComponentSession(prisma, uploadId, guard.userId!);
    if (!session) return NextResponse.json({ error: "Import session not found." }, { status: 404 });
    if (["READY", "FAILED"].includes(session.status)) {
      const patch = { status: "IMPORTING" as const, lastError: null, updatedAt: new Date().toISOString() };
      await mergeComponentSession(prisma, uploadId, guard.userId!, patch);
      session = { ...session, ...patch };
    }
    return NextResponse.json(publicComponentSession(uploadId, session));
  } catch (error) {
    return apiError(error, "component.import.start");
  }
}
