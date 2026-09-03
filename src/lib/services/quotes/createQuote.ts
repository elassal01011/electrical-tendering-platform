import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCompany } from "@/lib/company";
import { commercialTotals, roundMoney } from "./commercial";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import type { Prisma } from "@prisma/client";
export const quoteSchema = z.object({
  projectId: z.string().min(1),
  quoteNumber: z.string().max(60).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EGP"),
  validUntil: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), "Enter a valid expiry date"),
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
  terms: z
    .object({
      delivery: z.string().max(2000).default(""),
      payment: z.string().max(2000).default(""),
      warranty: z.string().max(2000).default(""),
      inclusions: z.string().max(3000).default(""),
      exclusions: z.string().max(3000).default(""),
      notes: z.string().max(3000).default(""),
    })
    .default({}),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(5000),
        manufacturer: z.string().max(100).optional(),
        partNumber: z.string().max(100).optional(),
        quantity: z.number().positive().max(999999999),
        unit: z.string().min(1).max(30).default("NO"),
        unitCost: z.number().nonnegative().max(1e10),
        unitSell: z.number().nonnegative().max(1e10),
      }),
    )
    .min(1)
    .max(500),
});
export async function createQuote(
  input: z.infer<typeof quoteSchema>,
  userId: string,
) {
  const company = await getCompany(),
    totals = commercialTotals(input.items, input.discountPct, input.vatPct);
  if (
    Math.abs(totals.marginPct) > 999 ||
    totals.totalCost >= 1e14 ||
    totals.netSell >= 1e14 ||
    input.items.some(
      (i) => i.unitCost * i.quantity >= 1e14 || i.unitSell * i.quantity >= 1e14,
    )
  )
    throw new ExcelError(
      "Quotation values exceed supported commercial limits.",
    );
  return prisma.$transaction(async (tx) => {
    await tx.project.findFirstOrThrow({
      where: { id: input.projectId, deletedAt: null },
    });
    const year = new Date().getFullYear();
    const seq = await tx.documentSequence.upsert({
      where: { key: "QUOTE-" + year },
      create: { key: "QUOTE-" + year, value: 1 },
      update: { value: { increment: 1 } },
    });
    const number =
      input.quoteNumber ||
      company.quotationPrefix +
        "-" +
        year +
        "-" +
        String(seq.value).padStart(4, "0");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"quote:" + number}))`;
    const previous = await tx.quote.findFirst({
      where: { quoteNumber: number },
      orderBy: { revision: "desc" },
    });
    if (previous && previous.projectId !== input.projectId)
      throw new ExcelError(
        "Quotation number belongs to a different project.",
        409,
      );
    const quote = await tx.quote.create({
      data: {
        projectId: input.projectId,
        quoteNumber: number,
        revision: (previous?.revision ?? 0) + 1,
        currency: input.currency,
        validUntil: new Date(input.validUntil),
        status: "DRAFT",
        createdBy: userId,
        discountPct: input.discountPct,
        vatPct: input.vatPct,
        terms: input.terms,
        companySnapshot: JSON.parse(
          JSON.stringify({
            companyName: company.companyName,
            productName: company.productName,
            logo: company.logo,
            email: company.email,
            phone: company.phone,
            website: company.website,
            address: company.address,
            taxNumber: company.taxNumber,
            commercialRegistration: company.commercialRegistration,
          }),
        ) as Prisma.InputJsonValue,
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
        userId,
        action: previous ? "QUOTE_REVISED" : "QUOTE_CREATED",
        entity: "Quote",
        entityId: quote.id,
        newValue: { quoteNumber: number, revision: quote.revision },
      },
    });
    return quote;
  });
}
