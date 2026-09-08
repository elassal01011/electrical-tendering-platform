import type { PrismaClient } from "@prisma/client";
import { normalizePricingIdentity as norm } from "./pricingImport";
import { importId, type StagedPrice } from "./writePricingImport";
export type CatalogValues = Omit<
  StagedPrice,
  "supplierId" | "componentId" | "supplierKey" | "componentKey"
>;
export async function planCatalog(
  db: PrismaClient,
  values: CatalogValues[],
  mode: "update" | "skip" | "revision",
) {
  const [suppliers, components] = await Promise.all([
    db.party.findMany({ where: { type: "SUPPLIER", deletedAt: null } }),
    db.component.findMany({ where: { active: true } }),
  ]);
  const supplierMap = new Map(
    suppliers.map((s) => [norm(s.companyName), s.id]),
  );
  const componentMap = new Map(
    components.map((c) => [
      JSON.stringify([norm(c.manufacturer), norm(c.partNumber)]),
      c.id,
    ]),
  );
  const descriptionMap = new Map(
    components.map((c) => [
      JSON.stringify([norm(c.manufacturer), norm(c.description)]),
      c.id,
    ]),
  );
  const staged: StagedPrice[] = values.map((v) => {
    const supplierKey = norm(v.supplier),
      componentKey = JSON.stringify([
        norm(v.manufacturer),
        norm(v.partNumber || v.supplierPartNumber || v.description),
      ]);
    const componentId =
      componentMap.get(componentKey) ??
      (!v.partNumber && !v.supplierPartNumber
        ? descriptionMap.get(
            JSON.stringify([norm(v.manufacturer), norm(v.description)]),
          )
        : undefined);
    return {
      ...v,
      supplierKey,
      componentKey,
      supplierId: supplierMap.get(supplierKey) ?? null,
      componentId: componentId ?? null,
    };
  });
  const ids = [
    ...new Set(
      staged.map((v) => v.supplierId ?? importId("supplier", v.supplierKey)),
    ),
  ];
  const existing = [] as {
    id: string;
    supplierId: string;
    componentId: string;
    supplierPartNumber: string | null;
    effectiveFrom: Date;
  }[];
  for (let offset = 0; offset < ids.length; offset += 100)
    existing.push(
      ...(await db.supplierPrice.findMany({
        where: { supplierId: { in: ids.slice(offset, offset + 100) } },
        orderBy: { effectiveFrom: "desc" },
        select: {
          id: true,
          supplierId: true,
          componentId: true,
          supplierPartNumber: true,
          effectiveFrom: true,
        },
      })),
    );
  const identity = (s: string, c: string, sku: string | null) =>
    JSON.stringify([s, sku ? `sku:${norm(sku)}` : `component:${c}`]);
  const prices = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    for (const key of [
      identity(p.supplierId, p.componentId, p.supplierPartNumber),
      identity(p.supplierId, p.componentId, null),
    ])
      if (!prices.has(key)) prices.set(key, p);
  }
  let skippedExisting = 0,
    duplicateRows = 0;
  const seen = new Set<string>();
  const rows: StagedPrice[] = [];
  for (const row of staged) {
    const key = identity(
      row.supplierId ?? importId("supplier", row.supplierKey),
      row.componentId ?? importId("component", row.componentKey),
      row.supplierPartNumber,
    );
    if (seen.has(key)) {
      duplicateRows++;
      continue;
    }
    seen.add(key);
    const old = prices.get(key);
    if (old && mode === "skip") {
      skippedExisting++;
      continue;
    }
    if (old && mode === "update") {
      row.targetPriceId = old.id;
      row.effectiveFrom = old.effectiveFrom;
    }
    if (old && mode === "revision" && row.effectiveFrom <= old.effectiveFrom) {
      // Same dated revision is an idempotent retry; older dates are rejected rather than overwriting history.
      if (row.effectiveFrom < old.effectiveFrom)
        throw new Error("REVISION_DATE_PRECEDES_EXISTING");
      row.targetPriceId = old.id;
    }
    rows.push(row);
  }
  return { rows, skippedExisting, duplicateRows };
}
