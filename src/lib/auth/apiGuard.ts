import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions, hasPermission } from "./authOptions";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/apiError";

export async function requirePermission(permission: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return {
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { roles: { include: { role: true } } },
    });
    if (
      !user ||
      !user.active ||
      user.deletedAt ||
      user.sessionVersion !== session.user.sessionVersion
    )
      return {
        error: NextResponse.json(
          { error: "Your session expired. Please sign in again." },
          { status: 401 },
        ),
      };
    const roles = user.roles.map((r) => r.role.name);
    session.user.roles = roles;
    if (permission !== "account.view" && !hasPermission(roles, permission)) {
      return {
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    return { session, userId: session.user.id };
  } catch (error) {
    return { error: apiError(error, "auth.guard") };
  }
}

export async function writeAuditLog(params: {
  userId?: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      oldValue: params.oldValue as any,
      newValue: params.newValue as any,
    },
  });
}
