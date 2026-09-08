import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import {
  rankCandidates,
  autoSelectBestMatch,
} from "@/lib/services/matching/componentMatcher";
import type { ParsedSpec } from "@/lib/services/matching/boqParser";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";
import { prismaErrorCode } from "@/lib/services/excel/genericDiagnostics";
import { apiError } from "@/lib/apiError";
export const maxDuration = 60;
export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const body = await req.json().catch(() => ({}));
    const acceptHigh = body.acceptHigh === true;
    const g = await requirePermission(acceptHigh ? "boq.review" : "boq.edit");
    if (g.error) return g.error;
    console.info("boq.match.start", { boqId: params.id, stage: "load", acceptHigh });
    const items = await prisma.bOQItem.findMany({
      where: { boqId: params.id, status: acceptHigh ? "SUGGESTED" : "UNMATCHED" },
      orderBy: { id: "asc" },
      take: 100,
    });
    const components = await prisma.component.findMany({ where: { active: true }, take: 5000 });
    const candidates = components.map((component) => ({
      ...component,
      currentA: component.currentA === null ? null : Number(component.currentA),
      breakingCapacityKA: component.breakingCapacityKA === null ? null : Number(component.breakingCapacityKA),
    }));
    let suggested = 0, matched = 0;
    const matches: Array<Record<string, unknown>> = [];
    const updates: ReturnType<typeof prisma.bOQItem.updateMany>[] = [];
    for (const item of items) {
      const parsed = (item.parsedSpec as unknown as ParsedSpec | null) ?? parseBoqDescription(item.rawDescription);
      const spec: ParsedSpec = {
        ...parsed,
        manufacturer: item.manufacturerRequirement || parsed.manufacturer,
        partNumber: item.modelRequirement || parsed.partNumber,
        model: item.modelRequirement || parsed.model,
      };
      const ranked = rankCandidates(spec, candidates);
      const auto = autoSelectBestMatch(ranked);
      const best = auto ?? ranked.find((candidate) => candidate.safe) ?? ranked[0];
      const accepted = Boolean(acceptHigh && auto && item.priceSource !== "MANUAL");
      updates.push(prisma.bOQItem.updateMany({
        where: { id: item.id, status: acceptHigh ? "SUGGESTED" : "UNMATCHED" },
        data: {
          status: accepted ? "MATCHED" : "SUGGESTED",
          matchedComponentId: best?.safe ? best.componentId : null,
          matchScore: best?.score ?? 0,
          matchReason: (best?.reasons ?? ["No catalog candidate found"]).join("; ") +
            (accepted ? " · High-confidence selection accepted by engineer action" : " · Preliminary Selection — Requires Engineer Verification"),
        },
      }));
      if (auto) suggested++;
      if (accepted) matched++;
      matches.push({ itemId: item.id, componentId: best?.componentId ?? null, confidence: best?.confidence ?? "LOW", score: best?.score ?? 0, reasons: best?.reasons ?? [], status: accepted ? "MATCHED" : "SUGGESTED" });
    }
    if (updates.length) await prisma.$transaction(updates);
    await prisma.auditLog.create({
      data: {
        userId: g.userId,
        action: "BOQ_MATCHED",
        entity: "BOQ",
        entityId: params.id,
        newValue: { processed: items.length, suggested, matched },
      },
    });
    const remaining = await prisma.bOQItem.count({
      where: { boqId: params.id, status: "UNMATCHED" },
    });
    console.info("boq.match.complete", { boqId: params.id, itemCount: items.length, matchedCount: matched, suggested, stage: "complete" });
    return NextResponse.json({ processed: items.length, suggested, matched, remaining, matches });
  } catch (e) {
    console.error("boq.match.error", { boqId: params.id, stage: "match", code: prismaErrorCode(e) });
    return apiError(e, "boq.match");
  }
}
