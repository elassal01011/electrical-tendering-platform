import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const PRICING_BATCH_SIZE = 50;
export const importId = (kind: string, key: string) =>
  `${kind}_${createHash("sha256").update(key).digest("hex")}`;
export type PricingProgress = {
  stage: string;
  imported: number;
  created: number;
  updated: number;
};
export type StagedPrice = {
  targetPriceId?: string;
  supplierId: string | null;
  componentId: string | null;
  supplierKey: string;
  componentKey: string;
  supplier: string;
  manufacturer: string;
  partNumber: string;
  supplierPartNumber: string | null;
  description: string;
  price: number;
  currency: string;
  unit: string;
  source: string;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

/** No interactive transaction: all lookups and planning precede bounded writes.
 * Earlier batches remain committed on failure. Deterministic IDs make retries safe.
 */
export async function writePricingImport(
  db: PrismaClient,
  rows: StagedPrice[],
  mode: string,
  progress: PricingProgress,
) {
  const suppliers = new Map<
    string,
    { id: string; type: "SUPPLIER"; companyName: string; country: string }
  >();
  const components = new Map<
    string,
    {
      id: string;
      manufacturer: string;
      partNumber: string;
      description: string;
      category: "OTHER";
      tags: string[];
    }
  >();
  const prepared = rows.map((item) => {
    const supplierId =
      item.supplierId ?? importId("supplier", item.supplierKey);
    const componentId =
      item.componentId ?? importId("component", item.componentKey);
    if (!item.supplierId)
      suppliers.set(supplierId, {
        id: supplierId,
        type: "SUPPLIER",
        companyName: item.supplier,
        country: "Egypt",
      });
    if (!item.componentId)
      components.set(componentId, {
        id: componentId,
        manufacturer: item.manufacturer || "Unspecified",
        partNumber:
          item.partNumber ||
          item.supplierPartNumber ||
          importId("description", item.componentKey),
        description:
          item.description ||
          item.partNumber ||
          item.supplierPartNumber ||
          "Imported component",
        category: "OTHER",
        tags: ["IMPORTED"],
      });
    return {
      ...(item.targetPriceId ? { id: item.targetPriceId } : {}),
      supplierId,
      componentId,
      supplierPartNumber: item.supplierPartNumber || item.partNumber || null,
      price: item.price,
      currency: item.currency,
      unit: item.unit,
      source: item.source,
      active: item.active,
      effectiveFrom: item.effectiveFrom,
      effectiveTo: item.effectiveTo,
    };
  });
  const key = (p: {
    supplierId: string;
    componentId: string;
    supplierPartNumber: string | null;
    effectiveFrom: Date;
  }) =>
    JSON.stringify([
      p.supplierId,
      p.componentId,
      p.supplierPartNumber,
      p.effectiveFrom.toISOString(),
    ]);
  progress.stage = "preload-prices";
  const existing = new Map<string, string>();
  const supplierIds = [...new Set(prepared.map((p) => p.supplierId))];
  for (let offset = 0; offset < supplierIds.length; offset += 100) {
    const prices = await db.supplierPrice.findMany({
      where: { supplierId: { in: supplierIds.slice(offset, offset + 100) } },
      select: {
        id: true,
        supplierId: true,
        componentId: true,
        supplierPartNumber: true,
        effectiveFrom: true,
      },
    });
    for (const price of prices) existing.set(key(price), price.id);
  }
  progress.stage = "write-suppliers";
  const newSuppliers = [...suppliers.values()];
  for (
    let offset = 0;
    offset < newSuppliers.length;
    offset += PRICING_BATCH_SIZE
  )
    await db.party.createMany({
      data: newSuppliers.slice(offset, offset + PRICING_BATCH_SIZE),
      skipDuplicates: true,
    });
  progress.stage = "write-components";
  const newComponents = [...components.values()];
  for (
    let offset = 0;
    offset < newComponents.length;
    offset += PRICING_BATCH_SIZE
  )
    await db.component.createMany({
      data: newComponents.slice(offset, offset + PRICING_BATCH_SIZE),
      skipDuplicates: true,
    });
  // Replacement is finalized only after all incoming prices have been saved.
  const incomingIds: string[] = [];
  for (let offset = 0; offset < prepared.length; offset += PRICING_BATCH_SIZE) {
    progress.stage = `write-prices:${offset / PRICING_BATCH_SIZE + 1}`;
    const batch = prepared.slice(offset, offset + PRICING_BATCH_SIZE);
    const operations = batch.flatMap((data) => {
      const id =
        data.id ?? existing.get(key(data)) ?? importId("price", key(data));
      incomingIds.push(id);
      return [
        db.supplierPrice.updateMany({
          where: {
            supplierId: data.supplierId,
            componentId: data.componentId,
            supplierPartNumber: data.supplierPartNumber,
            active: true,
            effectiveFrom: { lt: data.effectiveFrom },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: data.effectiveFrom } },
            ],
          },
          data: {
            active: false,
            effectiveTo: new Date(data.effectiveFrom.getTime() - 86400000),
          },
        }),
        db.supplierPrice.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        }),
      ];
    });
    await db.$transaction(operations);
    progress.imported += batch.length;
    progress.updated += batch.filter(
      (data) => data.id || existing.has(key(data)),
    ).length;
    progress.created = progress.imported - progress.updated;
  }
  if (mode === "replace") {
    progress.stage = "finalize-replacement";
    for (
      let offset = 0;
      offset < supplierIds.length;
      offset += PRICING_BATCH_SIZE
    )
      await db.supplierPrice.updateMany({
        where: {
          supplierId: {
            in: supplierIds.slice(offset, offset + PRICING_BATCH_SIZE),
          },
          id: { notIn: incomingIds },
          active: true,
        },
        data: { active: false },
      });
  }
}
