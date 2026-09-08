import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { planCatalog } from "@/lib/services/pricing/catalogPlan";
import {
  writePricingImport,
  type PricingProgress,
} from "@/lib/services/pricing/writePricingImport";
export const runtime = "nodejs";
const schema = z
  .object({
    id: z.string().optional(),
    supplier: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("Unspecified catalog supplier"),
    supplierPartNumber: z.string().trim().max(120).nullable().default(null),
    manufacturer: z.string().trim().min(1).max(200).default("Unspecified"),
    partNumber: z.string().trim().max(200).default(""),
    description: z.string().trim().max(5000).default(""),
    price: z.number().finite().nonnegative().lt(1e12),
    currency: z.string().regex(/^[A-Z]{3}$/),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine(
    (v) => v.partNumber || v.supplierPartNumber || v.description,
    "Supply a part number, SKU or description",
  )
  .refine(
    (v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom,
    "Valid To must not precede Valid From",
  );
export async function GET(req: NextRequest) {
  const guard = await requirePermission("pricing.view");
  if (guard.error) return guard.error;
  try {
    const p = req.nextUrl.searchParams,
      now = new Date();
    const page = Math.max(1, Math.min(100000, Number(p.get("page")) || 1));
    const q = p.get("q")?.trim();
    const where: Prisma.SupplierPriceWhereInput = {
      supplier: {
        deletedAt: null,
        ...(p.get("supplier")
          ? {
              companyName: {
                contains: p.get("supplier")!,
                mode: "insensitive",
              },
            }
          : {}),
      },
      component: {
        ...(p.get("manufacturer")
          ? {
              manufacturer: {
                contains: p.get("manufacturer")!,
                mode: "insensitive",
              },
            }
          : {}),
      },
      ...(p.get("currency")
        ? { currency: p.get("currency")!.toUpperCase() }
        : {}),
      ...(["true", "false"].includes(p.get("active") ?? "")
        ? { active: p.get("active") === "true" }
        : {}),
      ...(p.get("validity") === "expired" ? { effectiveTo: { lt: now } } : {}),
      ...(p.get("validity") === "valid"
        ? {
            effectiveFrom: { lte: now },
            AND: [
              { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
            ],
          }
        : {}),
      ...(q
        ? {
            OR: [
              { supplierPartNumber: { contains: q, mode: "insensitive" } },
              {
                component: { partNumber: { contains: q, mode: "insensitive" } },
              },
              {
                component: {
                  description: { contains: q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const minimum = p.get("min"),
      maximum = p.get("max");
    if (
      (minimum && !Number.isFinite(Number(minimum))) ||
      (maximum && !Number.isFinite(Number(maximum)))
    )
      return NextResponse.json(
        { error: "Invalid price range" },
        { status: 400 },
      );
    if (minimum || maximum)
      where.price = {
        ...(minimum ? { gte: Number(minimum) } : {}),
        ...(maximum ? { lte: Number(maximum) } : {}),
      };
    const base = { supplier: { deletedAt: null } };
    const [
      rows,
      total,
      totalPrices,
      activePrices,
      expiredPrices,
      suppliers,
      manufacturers,
    ] = await Promise.all([
      prisma.supplierPrice.findMany({
        where,
        include: { supplier: true, component: true },
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
        take: 100,
        skip: (page - 1) * 100,
      }),
      prisma.supplierPrice.count({ where }),
      prisma.supplierPrice.count({ where: base }),
      prisma.supplierPrice.count({ where: { ...base, active: true } }),
      prisma.supplierPrice.count({
        where: { ...base, effectiveTo: { lt: now } },
      }),
      prisma.supplierPrice.findMany({
        where: base,
        distinct: ["supplierId"],
        select: { supplierId: true },
      }),
      prisma.component.findMany({
        where: { supplierPrices: { some: base } },
        distinct: ["manufacturer"],
        select: { manufacturer: true },
      }),
    ]);
    return NextResponse.json({
      rows,
      total,
      page,
      summary: {
        totalPrices,
        activePrices,
        expiredPrices,
        suppliers: suppliers.length,
        manufacturers: manufacturers.length,
      },
    });
  } catch (error) {
    return apiError(error, "pricing.catalog.list");
  }
}
async function save(req: NextRequest, editing: boolean) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const input = schema.parse(await req.json());
    if (
      editing &&
      (!input.id ||
        !(await prisma.supplierPrice.findUnique({ where: { id: input.id } })))
    )
      return NextResponse.json({ error: "Price not found" }, { status: 404 });
    const plan = await planCatalog(
      prisma,
      [
        {
          ...input,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          unit: "NO",
          source: "Manual price catalog",
        },
      ],
      editing ? "update" : "revision",
    );
    if (editing) {
      plan.rows[0].targetPriceId = input.id;
      plan.rows[0].effectiveFrom = new Date(input.effectiveFrom);
    }
    const progress: PricingProgress = {
      stage: "manual",
      imported: 0,
      created: 0,
      updated: 0,
    };
    await writePricingImport(prisma, plan.rows, "append", progress);
    // Component description edits are explicit catalog edits, independent of price history.
    if (editing && plan.rows[0].componentId)
      await prisma.component.update({
        where: { id: plan.rows[0].componentId },
        data: { description: input.description },
      });
    await prisma.auditLog.create({
      data: {
        userId: guard.userId,
        action: editing ? "PRICE_UPDATED" : "PRICE_CREATED",
        entity: "SupplierPrice",
        entityId: input.id ?? "manual",
        newValue: { count: 1 },
      },
    });
    return NextResponse.json({ saved: true }, { status: editing ? 200 : 201 });
  } catch (error) {
    return apiError(error, "pricing.catalog.save");
  }
}
export const POST = (req: NextRequest) => save(req, false);
export const PUT = (req: NextRequest) => save(req, true);
export async function DELETE(req: NextRequest) {
  const hard = req.nextUrl.searchParams.get("delete") === "true";
  const guard = await requirePermission(
    hard ? "pricing.delete" : "pricing.edit",
  );
  if (guard.error) return guard.error;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "Price ID required" }, { status: 400 });
    if (
      hard &&
      (await prisma.bOQItem.count({ where: { appliedSupplierPriceId: id } }))
    )
      return NextResponse.json(
        {
          error:
            "This price is used by a BOQ. Deactivate it to retain history.",
        },
        { status: 409 },
      );
    await prisma.$transaction([
      hard
        ? prisma.supplierPrice.delete({ where: { id } })
        : prisma.supplierPrice.update({
            where: { id },
            data: { active: false },
          }),
      prisma.auditLog.create({
        data: {
          userId: guard.userId,
          action: hard ? "PRICE_DELETED" : "PRICE_DEACTIVATED",
          entity: "SupplierPrice",
          entityId: id,
          newValue: { count: 1 },
        },
      }),
    ]);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return apiError(error, "pricing.catalog.delete");
  }
}
