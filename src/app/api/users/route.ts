import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
const schema = z.object({
  email: z
    .string()
    .email()
    .transform((s) => s.toLowerCase().trim()),
  name: z.string().trim().min(1).max(120),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must be no more than 72 UTF-8 bytes.",
    ),
  role: z.nativeEnum(RoleName),
});
export async function GET() {
  try {
    const g = await requirePermission("user.manage");
    if (g.error) return g.error;
    const rows = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        roles: { select: { role: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return apiError(e, "users.list");
  }
}
export async function POST(req: Request) {
  try {
    const g = await requirePermission("user.manage");
    if (g.error) return g.error;
    const input = schema.parse(await req.json()),
      passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { name: input.role },
        create: { name: input.role },
        update: {},
      });
      const row = await tx.user.create({
        data: {
          name: input.name,
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
    const input = z
      .object({
        id: z.string().min(1),
        active: z.boolean().optional(),
        role: z.nativeEnum(RoleName).optional(),
        password: z
          .string()
          .min(12)
          .max(72)
          .refine(
            (value) => Buffer.byteLength(value, "utf8") <= 72,
            "Password must be no more than 72 UTF-8 bytes.",
          )
          .optional(),
      })
      .parse(await req.json());
    if (input.id === g.userId)
      throw new ExcelError(
        "Use your account page to change your password. Ask another administrator to change your role or access.",
      );
    const hash = input.password
      ? await bcrypt.hash(input.password, 12)
      : undefined;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.id },
        data: {
          active: input.active,
          passwordHash: hash,
          sessionVersion: { increment: 1 },
        },
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
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "USER_ACCESS_CHANGED",
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
