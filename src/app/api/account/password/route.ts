import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
export async function POST(req: Request) {
  try {
    const guard = await requirePermission("account.view");
    if (guard.error) return guard.error;
    const data = z
      .object({
        currentPassword: z
          .string()
          .max(72)
          .refine(
            (value) => Buffer.byteLength(value, "utf8") <= 72,
            "Password must be no more than 72 UTF-8 bytes.",
          ),
        newPassword: z
          .string()
          .min(12)
          .max(72)
          .refine(
            (value) => Buffer.byteLength(value, "utf8") <= 72,
            "Password must be no more than 72 UTF-8 bytes.",
          ),
      })
      .parse(await req.json());
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: guard.userId },
    });
    if (!(await bcrypt.compare(data.currentPassword, user.passwordHash)))
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 },
      );
    const hash = await bcrypt.hash(data.newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, sessionVersion: { increment: 1 } },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PASSWORD_CHANGED",
          entity: "User",
          entityId: user.id,
        },
      }),
    ]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e, "account.password");
  }
}
