import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { calculateBusbar, suggestStandardBarSize } from "@/lib/services/calculations/busbarCalculator";

const busbarInputSchema = z.object({
  type: z.literal("COPPER_SIZING"),
  ratedCurrentA: z.number().positive(),
  currentDensityAPerMm2: z.number().positive().default(1.6),
  numberOfBars: z.number().int().positive().default(1),
  lengthM: z.number().positive(),
  copperDensityKgPerM3: z.number().positive().default(8960),
});

/**
 * POST /api/panels/:id/calculate — runs an engineering calculation for the
 * panel and persists it as EngineeringCalculation with status PRELIMINARY
 * (spec Section 58: never presented as certified final design). Only the
 * copper busbar calculator (Section 16) is wired in this build; enclosure
 * sizing (Section 18) and thermal (Section 22) share the same
 * EngineeringCalculation table shape and are the next natural additions.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission("panel.edit");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = busbarInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { type, ...calcInput } = parsed.data;
  const result = calculateBusbar(calcInput);
  const suggestedBar = suggestStandardBarSize(result.requiredAreaMm2);

  const calc = await prisma.engineeringCalculation.create({
    data: {
      panelId: params.id,
      type,
      inputs: calcInput as any,
      outputs: { ...result, suggestedBar } as any,
      status: "PRELIMINARY",
    },
  });

  await writeAuditLog({
    userId: guard.userId,
    action: "ENGINEERING_CALCULATION_RUN",
    entity: "Panel",
    entityId: params.id,
    newValue: calc,
  });

  return NextResponse.json({ calculation: calc });
}
