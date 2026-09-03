import { NextResponse } from "next/server";
import { z } from "zod";
import {
  emailSchema,
  hashPassword,
  newPasswordSchema,
  loginAttemptKey,
} from "@/lib/auth/credentialPolicy";
import { usernameSchema } from "@/lib/auth/signupPolicy";
import { accountSelect } from "@/lib/auth/account";
import { requireSameOrigin } from "@/lib/auth/http";
import { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
const schema = z.object({
  email: emailSchema,
  username: usernameSchema.optional(),
  name: z.string().trim().min(1).max(120),
  password: newPasswordSchema,
  role: z.nativeEnum(RoleName),
});
export async function GET() {
  try {
    const g = await requirePermission("user.manage");
    if (g.error) return g.error;
    const rows = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { ...accountSelect, passwordHash: true },
      orderBy: { name: "asc" },
      take: 100,
    });
    return NextResponse.json({
      rows: rows.map(({ passwordHash, oauthAccounts, ...safe }) => ({
        ...safe,
        authMethod: oauthAccounts.some((a) => a.provider === "google")
          ? passwordHash
            ? "Google + password"
            : "Google"
          : "Password",
      })),
    });
  } catch (e) {
    return apiError(e, "users.list");
  }
}
export async function POST(req: Request) {
  try {
    const g = await requirePermission("user.manage");
    if (g.error) return g.error;
    requireSameOrigin(req);
    const input = schema.parse(await req.json()),
      passwordHash = await hashPassword(input.password);
    const user = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { name: input.role },
        create: { name: input.role },
        update: {},
      });
      const row = await tx.user.create({
        data: {
          name: input.name,
          username: input.username,
          email: input.email,
          passwordHash,
          roles: { create: { roleId: role.id } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "USER_CREATED",
          entity: "User",
          entityId: row.id,
          newValue: { name: input.name, role: input.role },
        },
      });
      return row;
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (e) {
    return apiError(e, "users.create");
  }
}
export async function PATCH(req: Request) {
  try {
    const g = await requirePermission("user.manage");
    if (g.error) return g.error;
    requireSameOrigin(req);
    const input = z
      .object({
        id: z.string().min(1),
        active: z.boolean().optional(),
        revokeSessions: z.boolean().optional(),
        role: z.nativeEnum(RoleName).optional(),
        password: newPasswordSchema.optional(),
      })
      .parse(await req.json());
    if (input.id === g.userId)
      throw new ExcelError(
        "Use your account page to change your password. Ask another administrator to change your role or access.",
      );
    const hash = input.password
      ? await hashPassword(input.password)
      : undefined;
    await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: input.id },
        data: {
          active: input.active,
          ...(input.active !== undefined ? { approvalPending: false } : {}),
          passwordHash: hash,
          sessionVersion: { increment: 1 },
        },
      });
      if (hash)
        await tx.loginAttempt.deleteMany({
          where: { key: loginAttemptKey(updatedUser.email) },
        });
      if (input.role) {
        const role = await tx.role.upsert({
          where: { name: input.role },
          create: { name: input.role },
          update: {},
        });
        await tx.userRole.deleteMany({ where: { userId: input.id } });
        await tx.userRole.create({
          data: { userId: input.id, roleId: role.id },
        });
      }
      const actions = [
        ...(input.active !== undefined
          ? [input.active ? "USER_ACTIVATED" : "USER_DEACTIVATED"]
          : []),
        ...(input.role ? ["ROLE_CHANGED"] : []),
        ...(hash ? ["PASSWORD_CHANGED"] : []),
        ...(input.revokeSessions ? ["SESSIONS_REVOKED"] : []),
      ];
      for (const action of actions)
        await tx.auditLog.create({
          data: {
            userId: g.userId,
            action,
            entity: "User",
            entityId: input.id,
            newValue: {
              active: input.active ?? null,
              role: input.role ?? null,
              passwordReset: !!hash,
            },
          },
        });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e, "users.update");
  }
}
