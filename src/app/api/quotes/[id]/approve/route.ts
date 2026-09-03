import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { getCompany } from "@/lib/company";
import { hasPermission } from "@/lib/auth/permissions";
export async function POST(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const data = z
      .object({
        action: z
          .enum(["submit", "approve", "reject", "changes", "send"])
          .default("approve"),
        comment: z.string().max(2000).default(""),
      })
      .parse(await req.json());
    const g = await requirePermission(
      data.action === "submit"
        ? "quote.submit"
        : data.action === "send"
          ? "quote.send"
          : "quote.approve",
    );
    if (g.error) return g.error;
    const company = await getCompany();
    const quote = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.id}))`;
      const q = await tx.quote.findUniqueOrThrow({ where: { id: params.id } });
      const newest = await tx.quote.findFirst({
        where: { projectId: q.projectId, quoteNumber: q.quoteNumber },
        orderBy: { revision: "desc" },
      });
      if (newest?.id !== q.id)
        throw new ExcelError(
          "Only the latest quotation revision can change status.",
          409,
        );
      const expected =
        data.action === "submit"
          ? "DRAFT"
          : data.action === "send"
            ? "APPROVED"
            : "INTERNAL_REVIEW";
      if (q.status !== expected)
        throw new ExcelError(
          "Quotation must be " +
            expected.replaceAll("_", " ") +
            " for this action.",
          409,
        );
      if (["reject", "changes"].includes(data.action) && !data.comment.trim())
        throw new ExcelError(
          "A comment is required when rejecting or requesting changes.",
        );
      if (data.action === "approve" && q.createdBy === g.userId)
        throw new ExcelError(
          "A different manager must approve this quotation.",
          403,
        );
      if (
        data.action === "approve" &&
        Number(q.marginPct) < company.minimumMarginPct &&
        (!hasPermission(g.session!.user.roles, "pricing.margin.override") ||
          !data.comment.trim())
      )
        throw new ExcelError(
          "Below minimum margin. An authorized margin override and approval comment are required.",
          422,
        );
      if (
        ["submit", "send", "approve"].includes(data.action) &&
        (!q.validUntil || q.validUntil < new Date())
      )
        throw new ExcelError(
          "Quotation validity must be in the future. Create a new revision with updated validity.",
          422,
        );
      const status =
        data.action === "submit"
          ? "INTERNAL_REVIEW"
          : data.action === "approve"
            ? "APPROVED"
            : data.action === "reject"
              ? "REJECTED"
              : data.action === "changes"
                ? "DRAFT"
                : "SENT";
      const updated = await tx.quote.update({
        where: { id: q.id },
        data: { status },
      });
      await tx.quoteRevision.create({
        data: {
          quoteId: q.id,
          changedBy: g.userId!,
          reason: data.comment || data.action,
          snapshot: { status: q.status, revision: q.revision },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "QUOTE_" + data.action.toUpperCase(),
          entity: "Quote",
          entityId: q.id,
          oldValue: { status: q.status },
          newValue: { status, comment: data.comment },
        },
      });
      return updated;
    });
    return NextResponse.json({ quote: { id: quote.id, status: quote.status } });
  } catch (e) {
    return apiError(e, "quotes.workflow");
  }
}
