import { NextResponse } from "next/server";
import { z } from "zod";
import {
  comparePassword,
  hashPassword,
  newPasswordSchema,
  loginAttemptKey,
} from "@/lib/auth/credentialPolicy";
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
        newPassword: newPasswordSchema,
      })
      .parse(await req.json());
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: guard.userId },
    });
    if (!(await comparePassword(data.currentPassword, user.passwordHash)))
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 },
      );
    const hash = await hashPassword(data.newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, sessionVersion: { increment: 1 } },
      }),
      prisma.loginAttempt.deleteMany({
        where: { key: loginAttemptKey(user.email) },
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
