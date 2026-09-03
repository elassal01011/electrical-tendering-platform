import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import {
  customerQuote,
  commercialTotals,
} from "@/lib/services/quotes/commercial";
import { createQuote, quoteSchema } from "@/lib/services/quotes/createQuote";
import { hasPermission } from "@/lib/auth/permissions";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { roundMoney } from "@/lib/services/quotes/commercial";
export async function PATCH(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("quote.create");
    if (g.error) return g.error;
    if (!hasPermission(g.session!.user.roles, "quote.cost.view"))
      return NextResponse.json(
        { error: "Internal costing access is required." },
        { status: 403 },
      );
    const input = quoteSchema.parse(await req.json()),
      totals = commercialTotals(input.items, input.discountPct, input.vatPct);
    const quote = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.id}))`;
      const q = await tx.quote.findUniqueOrThrow({ where: { id: params.id } });
      const latest = await tx.quote.findFirst({
        where: { quoteNumber: q.quoteNumber, projectId: q.projectId },
        orderBy: { revision: "desc" },
      });
      if (q.status !== "DRAFT" || latest?.id !== q.id)
        throw new ExcelError("Only the latest draft can be edited.", 409);
      if (input.projectId !== q.projectId)
        throw new ExcelError("A quotation cannot move to another project.");
      await tx.quoteItem.deleteMany({ where: { quoteId: q.id } });
      const updated = await tx.quote.update({
        where: { id: q.id },
        data: {
          currency: input.currency,
          validUntil: new Date(input.validUntil),
          discountPct: input.discountPct,
          vatPct: input.vatPct,
          terms: input.terms,
          totalCost: totals.totalCost,
          totalSell: totals.netSell,
          marginPct: totals.marginPct,
          items: {
            create: input.items.map((i) => ({
              ...i,
              lineTotal: roundMoney(i.quantity * i.unitSell),
            })),
          },
        },
        include: {
          items: true,
          project: { include: { client: true, consultant: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "QUOTE_DRAFT_UPDATED",
          entity: "Quote",
          entityId: q.id,
        },
      });
      return updated;
    });
    return NextResponse.json({ quote: customerQuote(quote) });
  } catch (e) {
    return apiError(e, "quotes.edit");
  }
}
export async function GET(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const internal = req.nextUrl.searchParams.get("view") === "internal";
    const g = await requirePermission(
      internal ? "quote.cost.view" : "quote.view",
    );
    if (g.error) return g.error;
    const quote = await prisma.quote.findUnique({
      where: { id: params.id },
      include: {
        items: true,
        project: { include: { client: true, consultant: true } },
      },
    });
    if (!quote)
      return NextResponse.json(
        { error: "Quotation not found." },
        { status: 404 },
      );
    const revisions = await prisma.quote.findMany({
      where: { projectId: quote.projectId, quoteNumber: quote.quoteNumber },
      select: {
        id: true,
        revision: true,
        totalSell: true,
        status: true,
        createdAt: true,
      },
      orderBy: { revision: "desc" },
    });
    const totals = commercialTotals(
      quote.items.map((i) => ({
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
        unitSell: Number(i.unitSell),
      })),
      Number(quote.discountPct),
      Number(quote.vatPct),
    );
    return NextResponse.json(
      internal
        ? {
            quote: { ...quote, company: quote.companySnapshot },
            totals,
            revisions,
          }
        : {
            quote: customerQuote(quote),
            totals: {
              subtotal: totals.subtotal,
              discount: totals.discount,
              netSell: totals.netSell,
              vat: totals.vat,
              grandTotal: totals.grandTotal,
            },
            revisions,
          },
    );
  } catch (e) {
    return apiError(e, "quotes.detail");
  }
}
export async function POST(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("quote.create");
    if (g.error) return g.error;
    if (!hasPermission(g.session!.user.roles, "quote.cost.view"))
      return NextResponse.json(
        { error: "Internal costing access is required to revise a quotation." },
        { status: 403 },
      );
    const q = await prisma.quote.findUniqueOrThrow({
      where: { id: params.id },
      include: { items: true },
    });
    const input = quoteSchema.parse({
      ...q,
      validUntil:
        q.validUntil?.toISOString() ||
        new Date(Date.now() + 30 * 86400000).toISOString(),
      discountPct: Number(q.discountPct),
      vatPct: Number(q.vatPct),
      terms: q.terms || {},
      items: q.items.map((i) => ({
        ...i,
        manufacturer: i.manufacturer || undefined,
        partNumber: i.partNumber || undefined,
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
        unitSell: Number(i.unitSell),
      })),
    });
    const quote = await createQuote(input, g.userId!);
    return NextResponse.json({ quote: customerQuote(quote) }, { status: 201 });
  } catch (e) {
    return apiError(e, "quotes.revise");
  }
}
