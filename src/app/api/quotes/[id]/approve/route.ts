import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission("quote.approve");
  if (guard.error) return guard.error;

  const quote = await prisma.quote.findUnique({ where: { id: params.id }, include: { items: true } });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.quote.update({ where: { id: params.id }, data: { status: "APPROVED" } });

  await prisma.quoteRevision.create({
    data: {
      quoteId: quote.id,
      changedBy: guard.userId!,
      reason: "Quote approved",
      snapshot: quote as any,
    },
  });

  await writeAuditLog({
    userId: guard.userId,
    action: "QUOTE_APPROVED",
    entity: "Quote",
    entityId: quote.id,
    oldValue: { status: quote.status },
    newValue: { status: "APPROVED" },
  });

  return NextResponse.json({ quote: updated });
}
