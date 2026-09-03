import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { quoteSchema, createQuote } from "@/lib/services/quotes/createQuote";
import { customerQuote } from "@/lib/services/quotes/commercial";
export async function GET(req: NextRequest) {
  try {
    const g = await requirePermission("quote.view");
    if (g.error) return g.error;
    const projectId = req.nextUrl.searchParams.get("projectId") || undefined,
      status = req.nextUrl.searchParams.get("status");
    const quotes = await prisma.quote.findMany({
      where: {
        projectId,
        ...(status === "INTERNAL_REVIEW"
          ? { status: "INTERNAL_REVIEW" as const }
          : {}),
      },
      select: {
        id: true,
        quoteNumber: true,
        revision: true,
        currency: true,
        status: true,
        totalSell: true,
        validUntil: true,
        createdAt: true,
        project: {
          select: {
            name: true,
            code: true,
            client: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ quotes });
  } catch (e) {
    return apiError(e, "quotes.list");
  }
}
export async function POST(req: Request) {
  try {
    const g = await requirePermission("quote.create");
    if (g.error) return g.error;
    const quote = await createQuote(
      quoteSchema.parse(await req.json()),
      g.userId!,
    );
    return NextResponse.json({ quote: customerQuote(quote) }, { status: 201 });
  } catch (e) {
    return apiError(e, "quotes.create");
  }
}
