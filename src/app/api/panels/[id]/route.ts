import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import {
  computePricingSummary,
  type LineItemInput,
} from "@/lib/services/pricing/pricingEngine";

/**
 * GET returns the panel BOM (Section 20) plus a live-computed financial
 * summary (Section 44) using: the cheapest active SupplierDiscount
 * applicable to each component's brand/category, the first active
 * LaborRate, the first active OverheadRule, and either a category-specific
 * MarginRule or a 20% default markup. This is a reasonable default wiring
 * — a full commercial-rules UI (Section 14, per project/client/category
 * overrides) is a clean extension point, not built out in this pass.
 */
export async function GET(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  const guard = await requirePermission("panel.view");
  if (guard.error) return guard.error;

  const panel = await prisma.panel.findUnique({
    where: { id: params.id },
    include: {
      sections: { orderBy: { order: "asc" } },
      components: { include: { component: true, section: true } },
      project: true,
    },
  });
  if (!panel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [laborRate, overheadRule] = await Promise.all([
    prisma.laborRate.findFirst({ where: { active: true } }),
    prisma.overheadRule.findFirst({ where: { active: true } }),
  ]);

  const items: LineItemInput[] = [];
  let totalLaborHours = 0;

  for (const pc of panel.components) {
    totalLaborHours += Number(pc.laborHours);
    if (pc.overridePrice != null) {
      items.push({
        listPrice: Number(pc.overridePrice),
        supplierDiscountPct: 0,
        quantity: Number(pc.quantity),
      });
      continue;
    }
    const now = new Date();
    const supplierPrice = await prisma.supplierPrice.findFirst({
      where: {
        componentId: pc.componentId,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { price: "asc" },
    });
    const discount = supplierPrice
      ? await prisma.supplierDiscount.findFirst({
          where: {
            supplierId: supplierPrice.supplierId,
            OR: [
              { brand: pc.component.manufacturer },
              { category: pc.component.category },
            ],
            effectiveFrom: { lte: now },
            AND: [
              { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
            ],
          },
          orderBy: { discountPct: "desc" },
        })
      : null;
    items.push({
      listPrice: supplierPrice
        ? Number(supplierPrice.price)
        : pc.component.listPrice
          ? Number(pc.component.listPrice)
          : 0,
      supplierDiscountPct: discount ? Number(discount.discountPct) : 0,
      quantity: Number(pc.quantity),
    });
  }

  const marginRule = await prisma.marginRule.findFirst({
    where: { active: true },
  });

  const summary =
    items.length > 0
      ? computePricingSummary({
          items,
          laborHours: totalLaborHours,
          hourlyRate: laborRate ? Number(laborRate.hourlyRate) : 0,
          overheadPct: overheadRule ? Number(overheadRule.overheadPct) : 0,
          mode: "MARKUP",
          markupPct: marginRule?.markupPct ? Number(marginRule.markupPct) : 20,
        })
      : null;

  return NextResponse.json({ panel, pricingSummary: summary });
}

const addComponentSchema = z.object({
  componentId: z.string().min(1),
  sectionId: z.string().optional(),
  quantity: z.number().positive().default(1),
  laborHours: z.number().nonnegative().default(0),
});

export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  const guard = await requirePermission("panel.edit");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = addComponentSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );

  const panelComponent = await prisma.panelComponent.create({
    data: { panelId: params.id, ...parsed.data },
  });

  await writeAuditLog({
    userId: guard.userId,
    action: "PANEL_COMPONENT_ADDED",
    entity: "Panel",
    entityId: params.id,
    newValue: panelComponent,
  });

  return NextResponse.json({ panelComponent }, { status: 201 });
}
