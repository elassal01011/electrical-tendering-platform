import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { rankCandidates, autoSelectBestMatch, type CandidateComponent } from "@/lib/services/matching/componentMatcher";
import type { ParsedSpec } from "@/lib/services/matching/boqParser";

const TOP_N_ALTERNATIVES = 5;

/**
 * POST /api/boq/:id/match-components equivalent (spec Section 10 & 41).
 * Runs the component matcher for every UNMATCHED item in the BOQ.
 * - If the best candidate clears the auto-select threshold AND has no
 *   safety shortfall, the item is marked MATCHED with that component.
 * - Otherwise it is marked SUGGESTED and the top N alternatives (with
 *   score + reason) are returned for the engineer to pick manually.
 * Nothing here silently commits a safety-relevant substitution — see
 * componentMatcher.autoSelectBestMatch and spec Section 58.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission("boq.edit");
  if (guard.error) return guard.error;

  const boq = await prisma.bOQ.findUnique({
    where: { id: params.id },
    include: { items: true },
  });
  if (!boq) return NextResponse.json({ error: "BOQ not found" }, { status: 404 });

  const catalog = await prisma.component.findMany({ where: { active: true } });
  const candidates: CandidateComponent[] = catalog.map((c) => ({
    id: c.id,
    manufacturer: c.manufacturer,
    category: c.category,
    currentA: c.currentA ? Number(c.currentA) : null,
    poles: c.poles,
    breakingCapacityKA: c.breakingCapacityKA ? Number(c.breakingCapacityKA) : null,
    voltageV: c.voltageV,
    tripUnit: c.tripUnit,
    description: c.description,
  }));

  const results = [];
  for (const item of boq.items) {
    if (!item.parsedSpec) continue;
    const spec = item.parsedSpec as unknown as ParsedSpec;
    const ranked = rankCandidates(spec, candidates);
    const top = ranked.slice(0, TOP_N_ALTERNATIVES);
    const auto = autoSelectBestMatch(ranked);

    const updated = await prisma.bOQItem.update({
      where: { id: item.id },
      data: auto
        ? {
            status: "MATCHED",
            matchedComponentId: auto.componentId,
            matchScore: auto.score,
            matchReason: auto.reasons.join("; "),
          }
        : {
            status: ranked.length > 0 && ranked[0].score > 0 ? "SUGGESTED" : "UNMATCHED",
            matchScore: ranked[0]?.score ?? null,
            matchReason: ranked[0]?.reasons.join("; ") ?? "No candidates found in catalog",
          },
    });

    results.push({ itemId: item.id, autoMatched: !!auto, alternatives: top });
  }

  await writeAuditLog({
    userId: guard.userId,
    action: "BOQ_MATCHED",
    entity: "BOQ",
    entityId: boq.id,
    newValue: { itemsProcessed: results.length },
  });

  return NextResponse.json({ results });
}
