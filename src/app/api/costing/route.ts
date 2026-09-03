import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { DEFAULT_PROFILES } from "@/lib/services/pricing/costModel";
const pct = z.number().min(0).max(99);
const profile = z.object({
  targetPct: pct,
  overheadPct: pct,
  contingencyPct: pct,
  warrantyPct: pct,
  financePct: pct,
  commissionPct: pct,
});
export async function GET() {
  try {
    const g = await requirePermission("pricing.view");
    if (g.error) return g.error;
    const [profiles, rates, labor, discounts, suppliers] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: "pricing.profiles" } }),
      prisma.exchangeRate.findMany({ orderBy: { asOf: "desc" }, take: 100 }),
      prisma.laborRate.findMany({ where: { active: true }, take: 100 }),
      prisma.supplierDiscount.findMany({
        include: { supplier: { select: { companyName: true } } },
        take: 100,
      }),
      prisma.party.findMany({
        where: { type: "SUPPLIER", deletedAt: null },
        select: { id: true, companyName: true },
        take: 100,
      }),
    ]);
    return NextResponse.json({
      profiles: profiles?.value || DEFAULT_PROFILES,
      rates,
      labor,
      discounts,
      suppliers,
    });
  } catch (e) {
    return apiError(e, "costing.get");
  }
}
export async function POST(req: Request) {
  try {
    const g = await requirePermission("pricing.edit");
    if (g.error) return g.error;
    const data = z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("profiles"),
          profiles: z.object({
            AGGRESSIVE: profile,
            STANDARD: profile,
            SAFE: profile,
          }),
        }),
        z.object({
          kind: z.literal("rate"),
          baseCurrency: z.string().regex(/^[A-Z]{3}$/),
          quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
          rate: z.number().positive().max(1e9),
        }),
        z.object({
          kind: z.literal("labor"),
          label: z.string().min(1).max(100),
          hourlyRate: z.number().nonnegative(),
          currency: z.string().regex(/^[A-Z]{3}$/),
        }),
        z.object({
          kind: z.literal("discount"),
          supplierId: z.string().min(1),
          brand: z.string().max(100).optional(),
          discountPct: z.number().min(0).max(100),
          qtyBandMin: z.number().int().nonnegative().default(0),
        }),
      ])
      .parse(await req.json());
    await prisma.$transaction(async (tx) => {
      if (data.kind === "profiles")
        await tx.systemSetting.upsert({
          where: { key: "pricing.profiles" },
          create: { key: "pricing.profiles", value: data.profiles },
          update: { value: data.profiles },
        });
      else if (data.kind === "rate") {
        const { kind, ...record } = data;
        await tx.exchangeRate.create({ data: record });
      } else if (data.kind === "labor") {
        const { kind, ...record } = data;
        await tx.laborRate.upsert({
          where: {
            label_currency: { label: record.label, currency: record.currency },
          },
          create: record,
          update: record,
        });
      } else {
        const { kind, ...record } = data;
        await tx.supplierDiscount.create({
          data: { ...record, brand: record.brand || null },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "PRICING_CONFIGURATION_UPDATED",
          entity: "Pricing",
          entityId: data.kind,
          newValue: data,
        },
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e, "costing.update");
  }
}
