import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

const createQuoteSchema = z.object({
  projectId: z.string().min(1),
  quoteNumber: z.string().min(1),
  currency: z.string().default("EGP"),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitCost: z.number().nonnegative(),
        unitSell: z.number().nonnegative(),
      })
    )
    .min(1),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission("quote.view");
  if (guard.error) return guard.error;
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;

  const quotes = await prisma.quote.findMany({
    where: projectId ? { projectId } : undefined,
    include: { items: true },
    orderBy: [{ quoteNumber: "asc" }, { revision: "desc" }],
  });
  return NextResponse.json({ quotes });
}

/**
 * Creates Quote revision 1 (or the next revision, if a quote with this
 * quoteNumber already exists — quote versions are never overwritten,
 * per spec Section 25).
 */
export async function POST(req: NextRequest) {
  const guard = await requirePermission("quote.create");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = createQuoteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { projectId, quoteNumber, currency, items } = parsed.data;

  const existingMax = await prisma.quote.findFirst({
    where: { projectId, quoteNumber },
    orderBy: { revision: "desc" },
  });
  const nextRevision = existingMax ? existingMax.revision + 1 : 1;

  const totalCost = items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0);
  const totalSell = items.reduce((sum, i) => sum + i.unitSell * i.quantity, 0);
  const marginPct = totalSell > 0 ? ((totalSell - totalCost) / totalSell) * 100 : 0;

  const quote = await prisma.quote.create({
    data: {
      projectId,
      quoteNumber,
      revision: nextRevision,
      currency,
      status: "DRAFT",
      totalCost,
      totalSell,
      marginPct,
      items: {
        create: items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitCost: i.unitCost,
          unitSell: i.unitSell,
          lineTotal: i.unitSell * i.quantity,
        })),
      },
    },
    include: { items: true },
  });

  await writeAuditLog({
    userId: guard.userId,
    action: "QUOTE_CREATED",
    entity: "Quote",
    entityId: quote.id,
    newValue: { quoteNumber, revision: nextRevision, totalSell },
  });

  return NextResponse.json({ quote }, { status: 201 });
}
