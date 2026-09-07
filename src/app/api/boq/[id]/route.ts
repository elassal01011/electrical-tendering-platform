import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import type { Prisma } from "@prisma/client";
import { summarizeBoqPrices } from "@/lib/services/pricing/boqPricing";
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
      q = (req.nextUrl.searchParams.get("q") || "").slice(0, 100),
      filter = req.nextUrl.searchParams.get("filter") || "all";
    const filterWhere: Prisma.BOQItemWhereInput =
      filter === "priced"
        ? { appliedUnitPrice: { not: null } }
        : filter === "unpriced"
          ? { appliedUnitPrice: null }
          : filter === "manual"
            ? { priceSource: "MANUAL" }
            : filter === "supplier"
              ? { priceSource: "SUPPLIER_PRICE" }
              : filter === "review"
                ? { status: { in: ["UNMATCHED", "SUGGESTED"] } }
                : {};
    const where = {
      boqId: params.id,
      ...filterWhere,
      ...(q
        ? { rawDescription: { contains: q, mode: "insensitive" as const } }
        : {}),
    };
    const [boq, total, summaryItems] = await Promise.all([
      prisma.bOQ.findUnique({
        where: { id: params.id },
        include: {
          items: {
            where,
            include: { matchedComponent: true, appliedSupplier: true },
            orderBy: { lineNo: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          },
          project: true,
        },
      }),
      prisma.bOQItem.count({ where }),
      prisma.bOQItem.findMany({
        where: { boqId: params.id },
        select: {
          quantity: true,
          appliedUnitPrice: true,
          appliedCurrency: true,
          priceSource: true,
        },
      }),
    ]);
    if (!boq)
      return NextResponse.json({ error: "BOQ not found." }, { status: 404 });
    return NextResponse.json({
      boq,
      total,
      page,
      pageSize,
      summary: summarizeBoqPrices(summaryItems),
    });
  } catch (e) {
    return apiError(e, "boq.detail");
  }
}
