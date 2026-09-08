import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/apiError";
import { publicComponentSession } from "@/lib/services/components/componentSession";
import { mergeComponentSession, readComponentSession } from "@/lib/services/components/componentSessionStore";

type Context = { params: Promise<{ sessionId: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    const guard = await requirePermission("catalog.view");
    if (guard.error) return guard.error;
    const id = (await params).sessionId;
    const session = await readComponentSession(prisma, id, guard.userId!);
    return session
      ? NextResponse.json(publicComponentSession(id, session))
      : NextResponse.json({ error: "Import session not found." }, { status: 404 });
  } catch (error) { return apiError(error, "component.import.status"); }
}
export async function DELETE(_: Request, { params }: Context) {
  try {
    const guard = await requirePermission("catalog.edit");
    if (guard.error) return guard.error;
    const id = (await params).sessionId;
    const session = await readComponentSession(prisma, id, guard.userId!);
    if (!session) return NextResponse.json({ error: "Import session not found." }, { status: 404 });
    if (session.leaseToken) return NextResponse.json({ error: "Pause after the active batch before cancelling." }, { status: 409 });
    const patch = { status: "CANCELLED" as const, updatedAt: new Date().toISOString() };
    await mergeComponentSession(prisma, id, guard.userId!, patch);
    return NextResponse.json(publicComponentSession(id, { ...session, ...patch }));
  } catch (error) { return apiError(error, "component.import.cancel"); }
}
