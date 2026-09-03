import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import {
  rankCandidates,
  autoSelectBestMatch,
} from "@/lib/services/matching/componentMatcher";
import type { ParsedSpec } from "@/lib/services/matching/boqParser";
import { apiError } from "@/lib/apiError";
export const maxDuration = 60;
export async function POST(
  _: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("boq.edit");
    if (g.error) return g.error;
    const items = await prisma.bOQItem.findMany({
      where: { boqId: params.id, status: "UNMATCHED" },
      orderBy: { id: "asc" },
      take: 100,
    });
    let suggested = 0;
    for (const item of items) {
      if (!item.parsedSpec) continue;
      const spec = item.parsedSpec as unknown as ParsedSpec;
      const rows = await prisma.component.findMany({
        where: {
          active: true,
          ...(spec.category ? { category: spec.category as never } : {}),
        },
        take: 1000,
      });
      const ranked = rankCandidates(
        spec,
        rows.map((c) => ({
          ...c,
          currentA: c.currentA === null ? null : Number(c.currentA),
          breakingCapacityKA:
            c.breakingCapacityKA === null ? null : Number(c.breakingCapacityKA),
        })),
      );
      const auto = autoSelectBestMatch(ranked);
      await prisma.bOQItem.updateMany({
        where: { id: item.id, status: "UNMATCHED" },
        data: {
          status: "SUGGESTED",
          matchedComponentId: auto?.componentId ?? null,
          matchScore: auto?.score ?? ranked[0]?.score ?? 0,
          matchReason:
            (
              auto?.reasons ??
              ranked[0]?.reasons ?? ["No catalog candidate found"]
            ).join("; ") +
            " · Preliminary Selection — Requires Engineer Verification",
        },
      });
      if (auto) suggested++;
    }
    await prisma.auditLog.create({
      data: {
        userId: g.userId,
        action: "BOQ_MATCHED",
        entity: "BOQ",
        entityId: params.id,
        newValue: { processed: items.length, suggested },
      },
    });
    const remaining = await prisma.bOQItem.count({
      where: { boqId: params.id, status: "UNMATCHED" },
    });
    return NextResponse.json({ processed: items.length, suggested, remaining });
  } catch (e) {
    return apiError(e, "boq.match");
  }
}
