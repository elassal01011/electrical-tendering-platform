import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
export async function GET(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("boq.view");
    if (g.error) return g.error;
    const page = Math.max(
        1,
        Math.floor(Number(req.nextUrl.searchParams.get("page")) || 1),
      ),
      pageSize = Math.min(
        500,
        Math.max(
          1,
          Math.floor(Number(req.nextUrl.searchParams.get("pageSize")) || 100),
        ),
      ),
      q = (req.nextUrl.searchParams.get("q") || "").slice(0, 100);
    const where = {
      boqId: params.id,
      ...(q
        ? { rawDescription: { contains: q, mode: "insensitive" as const } }
        : {}),
    };
    const [boq, total] = await Promise.all([
      prisma.bOQ.findUnique({
        where: { id: params.id },
        include: {
          items: {
            where: q
              ? { rawDescription: { contains: q, mode: "insensitive" } }
              : {},
            include: { matchedComponent: true, appliedSupplier: true },
            orderBy: { lineNo: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          },
          project: true,
        },
      }),
      prisma.bOQItem.count({ where }),
    ]);
    if (!boq)
      return NextResponse.json({ error: "BOQ not found." }, { status: 404 });
    return NextResponse.json({ boq, total, page, pageSize });
  } catch (e) {
    return apiError(e, "boq.detail");
  }
}
