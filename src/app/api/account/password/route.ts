import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { changeAccountPassword } from "@/lib/auth/account";
import { requireSameOrigin, registrationResponse } from "@/lib/auth/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const guard = await requirePermission("account.view");
    if (guard.error) return guard.error;
    requireSameOrigin(req);
    await changeAccountPassword(
      prisma,
      guard.userId,
      guard.session.user.sessionVersion,
      await req.json(),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return registrationResponse(error);
  }
}
