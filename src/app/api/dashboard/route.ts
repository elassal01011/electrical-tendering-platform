import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { hasPermission } from "@/lib/auth/permissions";
import { apiError } from "@/lib/apiError";
export async function GET() {
  try {
    const g = await requirePermission("project.view");
    if (g.error) return g.error;
    const roles = g.session!.user.roles,
      canQuote = hasPermission(roles, "quote.view"),
      canCost = hasPermission(roles, "quote.cost.view");
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const [
      statuses,
      projects,
      pendingEngineering,
      pendingApproval,
      quoteCount,
      latestQuotes,
      activity,
    ] = await Promise.all([
      prisma.project.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: true,
      }),
      prisma.project.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ["WON", "LOST", "CANCELLED"] },
        },
        include: { client: { select: { companyName: true } } },
        orderBy: [
          { tenderDeadline: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        take: 8,
      }),
      hasPermission(roles, "boq.view")
        ? prisma.bOQItem.count({
            where: { status: { in: ["UNMATCHED", "SUGGESTED"] } },
          })
        : null,
      hasPermission(roles, "quote.approve")
        ? prisma.quote.count({ where: { status: "INTERNAL_REVIEW" } })
        : null,
      canQuote
        ? prisma.quote.count({ where: { createdAt: { gte: start } } })
        : null,
      canQuote
        ? prisma.quote.findMany({
            distinct: ["projectId", "quoteNumber"],
            orderBy: [
              { projectId: "asc" },
              { quoteNumber: "asc" },
              { revision: "desc" },
            ],
            select: {
              projectId: true,
              currency: true,
              totalSell: true,
              totalCost: canCost,
              project: { select: { status: true } },
            },
          })
        : [],
      prisma.auditLog.findMany({
        where: { entity: "Project" },
        select: {
          id: true,
          action: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const pipeline: Record<string, number> = {};
    let sell = 0,
      cost = 0;
    for (const q of latestQuotes) {
      if (!["WON", "LOST", "CANCELLED"].includes(q.project.status))
        pipeline[q.currency] =
          (pipeline[q.currency] || 0) + Number(q.totalSell ?? 0);
      if (canCost) {
        sell += Number(q.totalSell ?? 0);
        cost += Number(q.totalCost ?? 0);
      }
    }
    const byStatus = Object.fromEntries(
      statuses.map((s) => [s.status, s._count]),
    );
    const won = byStatus.WON || 0,
      lost = byStatus.LOST || 0;
    return NextResponse.json({
      byStatus,
      projects,
      pendingEngineering,
      pendingApproval,
      quoteCount,
      pipeline,
      won,
      winRate: won + lost ? (won / (won + lost)) * 100 : null,
      averageMargin:
        canCost &&
        sell > 0 &&
        new Set(latestQuotes.map((q) => q.currency)).size === 1
          ? ((sell - cost) / sell) * 100
          : null,
      activity,
    });
  } catch (e) {
    return apiError(e, "dashboard");
  }
}
