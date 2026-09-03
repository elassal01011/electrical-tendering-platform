import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { getAccount, updateProfile } from "@/lib/auth/account";
import { requireSameOrigin, registrationResponse } from "@/lib/auth/http";
import { Prisma } from "@prisma/client";
export const runtime = "nodejs";
export async function GET() {
  try {
    const guard = await requirePermission("account.view");
    if (guard.error) return guard.error;
    return NextResponse.json(await getAccount(prisma, guard.userId));
  } catch (error) {
    return registrationResponse(error);
  }
}
export async function PATCH(req: Request) {
  try {
    const guard = await requirePermission("account.view");
    if (guard.error) return guard.error;
    requireSameOrigin(req);
    await updateProfile(prisma, guard.userId, await req.json());
    return NextResponse.json(await getAccount(prisma, guard.userId));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    return registrationResponse(error);
  }
}
