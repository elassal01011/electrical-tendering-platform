import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
export async function GET(req: NextRequest) {
  try {
    const g = await requirePermission("audit.view");
    if (g.error) return g.error;
    const q = (req.nextUrl.searchParams.get("q") || "").slice(0, 100),
      page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
    const where = q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" as const } },
            { entity: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true } } },
        take: 50,
        skip: (page - 1) * 50,
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return NextResponse.json({ rows, total, page });
  } catch (e) {
    return apiError(e, "audit.list");
  }
}
