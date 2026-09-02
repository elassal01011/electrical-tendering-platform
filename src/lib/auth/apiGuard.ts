import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions, hasPermission } from "./authOptions";
import { prisma } from "@/lib/db/prisma";

export async function requirePermission(permission: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const roles = session.user.roles ?? [];
  if (!hasPermission(roles, permission)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, userId: session.user.id };
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
