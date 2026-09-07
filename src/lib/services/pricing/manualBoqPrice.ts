import { z } from "zod";

export const manualPriceSchema = z.object({
  unitCost: z.coerce.number().positive().max(1e10),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  supplierId: z.string().min(1).nullable().optional(),
  supplierReference: z.string().trim().max(200).optional().default(""),
  discountPct: z.coerce.number().min(0).max(100).optional().default(0),
  leadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  validUntil: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.")
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).optional().default(""),
  replaceExisting: z.boolean().default(false),
});

export type ManualPriceInput = z.infer<typeof manualPriceSchema>;
export function calculateManualPrice(
  quantity: number,
  unitCost: number,
  discountPct = 0,
) {
  const netUnitCost =
    Math.round((unitCost * (1 - discountPct / 100) + Number.EPSILON) * 100) /
    100;
  const totalCost =
    Math.round((quantity * netUnitCost + Number.EPSILON) * 100) / 100;
  return { netUnitCost, totalCost };
}

export function manualPriceData(input: ManualPriceInput, now = new Date()) {
  return {
    appliedSupplierPriceId: null,
    appliedSupplierId: input.supplierId || null,
    appliedUnitPrice: calculateManualPrice(1, input.unitCost, input.discountPct)
      .netUnitCost,
    appliedCurrency: input.currency,
    priceAppliedAt: now,
    priceSource: "MANUAL",
    manualBaseUnitCost: input.unitCost,
    manualDiscountPct: input.discountPct,
    manualSupplierReference: input.supplierReference || null,
    manualLeadTimeDays: input.leadTimeDays ?? null,
    manualValidUntil: input.validUntil ? new Date(input.validUntil) : null,
    manualPriceNotes: input.notes || null,
  };
}

export const clearPriceData = {
  appliedSupplierPriceId: null,
  appliedSupplierId: null,
  appliedUnitPrice: null,
  appliedCurrency: null,
  priceAppliedAt: null,
  priceSource: null,
  manualBaseUnitCost: null,
  manualDiscountPct: null,
  manualSupplierReference: null,
  manualLeadTimeDays: null,
  manualValidUntil: null,
  manualPriceNotes: null,
};
