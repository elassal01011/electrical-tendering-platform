import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

export async function GET(req: NextRequest) {
  const guard = await requirePermission("catalog.view");
  if (guard.error) return guard.error;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(Number(searchParams.get("pageSize")) || 50)),
  );

  const where: any = { active: true };
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { partNumber: { contains: q, mode: "insensitive" } },
      { manufacturer: { contains: q, mode: "insensitive" } },
    ];
  }

  const components = await prisma.component.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { manufacturer: "asc" },
  });
  const total = await prisma.component.count({ where });
  const active = await prisma.component.findMany({
    where: { active: true },
    select: { manufacturer: true, category: true, tags: true },
  });
  const needsReview = active.filter((component) =>
    component.tags.includes("NEEDS_REVIEW"),
  ).length;

  return NextResponse.json({
    components,
    total,
    page,
    pageSize,
    summary: {
      totalComponents: active.length,
      manufacturers: new Set(
        active.map((component) => component.manufacturer.toLowerCase()),
      ).size,
      categories: new Set(active.map((component) => component.category)).size,
      verifiedComponents: active.length - needsReview,
      needsReview,
    },
  });
}

const createComponentSchema = z.object({
  manufacturer: z.string().min(1),
  partNumber: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  voltageV: z.number().optional(),
  currentA: z.number().optional(),
  poles: z.number().optional(),
  breakingCapacityKA: z.number().optional(),
  tripUnit: z.string().optional(),
  mounting: z.string().optional(),
  listPrice: z.number().optional(),
  listPriceCurrency: z.string().default("USD"),
  tags: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const guard = await requirePermission("catalog.edit");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = createComponentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const component = await prisma.component.create({ data: parsed.data as any });

  await writeAuditLog({
    userId: guard.userId,
    action: "COMPONENT_CREATED",
    entity: "Component",
    entityId: component.id,
    newValue: component,
  });

  return NextResponse.json({ component }, { status: 201 });
}
