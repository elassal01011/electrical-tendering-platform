import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import ExcelJS from "exceljs";
import { loadWorkbook as readWorkbook } from "@/lib/services/excel/readWorkbook";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import {
  date,
  normalizePricingIdentity,
  parsePricingHeaders,
  text,
  valueAt,
} from "@/lib/services/pricing/pricingImport";

import {
  writePricingImport,
  type PricingProgress,
} from "@/lib/services/pricing/writePricingImport";
import { logPricingImportError } from "@/lib/services/pricing/pricingImportDiagnostics";

export const runtime = "nodejs";
export const maxDuration = 60;
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((v) => v.toUpperCase());
const priceSchemaBase = z.object({
  supplierId: z.string().min(1),
  componentId: z.string().min(1),
  price: z.number().finite().nonnegative(),
  currency: currency.default("EGP"),
  supplierPartNumber: z.string().trim().max(120).nullable().optional(),
  unit: z.string().trim().min(1).max(30).default("NO"),
  source: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
});
const withValidDates = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (v: any) =>
      !v.effectiveFrom ||
      !v.effectiveTo ||
      new Date(v.effectiveFrom) <= new Date(v.effectiveTo),
    {
      message: "Effective To must not precede Effective From",
      path: ["effectiveTo"],
    },
  );
const priceSchema = withValidDates(priceSchemaBase);
const fail = (error: string, status: number, details: unknown[] = []) =>
  NextResponse.json({ success: false, error, details }, { status });
const fileLike = (v: FormDataEntryValue | null): v is File =>
  !!v && typeof v === "object" && "arrayBuffer" in v && "name" in v;

// Only application-authored labels/messages belong here, never workbook values or exceptions.
function patchValidation(issues: { field: string; message: string }[]) {
  console.warn("pricing.validation", {
    method: "PATCH",
    issues: issues.map((issue) => ({
      path: issue.field,
      message: issue.message,
      code: "custom",
    })),
  });
  return NextResponse.json(
    { success: false, error: "VALIDATION_ERROR", issues, created: 0, updated: 0, rejected: issues.length },
    { status: 422 },
  );
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission("pricing.view");
  if (guard.error) return guard.error;
  try {
    const p = new URL(req.url).searchParams,
      q = p.get("q")?.trim(),
      active = p.get("active"),
      category = p.get("category"),
      supplierId = p.get("supplierId"),
      sort = p.get("sort"),
      direction = p.get("direction") === "asc" ? "asc" : "desc";
    const rows = await prisma.supplierPrice.findMany({
      where: {
        supplier: { deletedAt: null },
        ...(supplierId ? { supplierId } : {}),
        ...(active === "true" || active === "false"
          ? { active: active === "true" }
          : {}),
        ...(category ? { component: { category: category as never } } : {}),
        ...(q
          ? {
              OR: [
                { supplierPartNumber: { contains: q, mode: "insensitive" } },
                {
                  component: {
                    partNumber: { contains: q, mode: "insensitive" },
                  },
                },
                {
                  component: {
                    description: { contains: q, mode: "insensitive" },
                  },
                },
                {
                  supplier: {
                    companyName: { contains: q, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      },
      include: { supplier: true, component: true },
      orderBy:
        sort === "price"
          ? { price: direction }
          : sort === "supplier"
            ? { supplier: { companyName: direction } }
            : { effectiveFrom: direction },
      take: 500,
    });
    const [suppliers, components] = await Promise.all([
      prisma.party.findMany({
        where: { type: "SUPPLIER", deletedAt: null },
        orderBy: { companyName: "asc" },
      }),
      prisma.component.findMany({
        where: { active: true },
        orderBy: [{ manufacturer: "asc" }, { partNumber: "asc" }],
        take: 200,
      }),
    ]);
    return NextResponse.json({ success: true, rows, suppliers, components });
  } catch (e) {
    console.error("Pricing GET", e);
    return fail("Unable to load pricing.", 500);
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const parsed = priceSchema.safeParse(await req.json());
    if (!parsed.success)
      return fail("Invalid price record.", 400, parsed.error.issues);
    const [supplier, component] = await Promise.all([
      prisma.party.findFirst({
        where: {
          id: parsed.data.supplierId,
          type: "SUPPLIER",
          deletedAt: null,
        },
      }),
      prisma.component.findFirst({
        where: { id: parsed.data.componentId, active: true },
      }),
    ]);
    if (!supplier || !component)
      return fail("Supplier and active catalog component are required.", 400, [
        {
          field: !supplier ? "supplierId" : "componentId",
          message: !supplier
            ? "Supplier does not exist or is inactive."
            : "Component does not exist or is inactive.",
        },
      ]);
    const { effectiveFrom, effectiveTo, ...data } = parsed.data;
    const price = await prisma.supplierPrice.create({
      data: {
        ...data,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
      include: { supplier: true, component: true },
    });
    await writeAuditLog({
      userId: guard.userId,
      action: "SUPPLIER_PRICE_CREATED",
      entity: "SupplierPrice",
      entityId: price.id,
      newValue: price,
    });
    return NextResponse.json({ success: true, price }, { status: 201 });
  } catch (e) {
    console.error("Pricing POST", e);
    return fail("Unable to create price.", 500);
  }
}
export async function PUT(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const parsed = withValidDates(
      priceSchemaBase.extend({ id: z.string().min(1) }),
    ).safeParse(await req.json());
    if (!parsed.success)
      return fail("Invalid price record.", 400, parsed.error.issues);
    const { id, effectiveFrom, effectiveTo, ...data } = parsed.data;
    const price = await prisma.supplierPrice.update({
      where: { id },
      data: {
        ...data,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
      include: { supplier: true, component: true },
    });
    return NextResponse.json({ success: true, price });
  } catch (e) {
    console.error("Pricing PUT", e);
    return fail("Unable to update price.", 500);
  }
}
export async function DELETE(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Missing id.", 400);
  try {
    await prisma.supplierPrice.update({
      where: { id },
      data: { active: false },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Pricing DELETE", e);
    return fail("Unable to deactivate price.", 500);
  }
}

export async function PATCH(req: NextRequest) {
  const progress: PricingProgress = {
    stage: "read-workbook",
    imported: 0,
    created: 0,
    updated: 0,
  };
  let total = 0;
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const form = await req.formData(),
      file = form.get("file");
    if (!fileLike(file) || file.size === 0)
      return fail("Attach a non-empty XLSX file in the 'file' field.", 400);
    if (file.size > 3.5 * 1024 * 1024)
      return fail(
        "Supplier price lists must be below 3.5 MB. Split the workbook and import each part.",
        413,
      );
    const workbook = await readWorkbook(file);
    const sheet = workbook.worksheets[0];
    if (!sheet) return patchValidation([{ field: "file", message: "The XLSX file contains no worksheet." }]);
    const { columnMap, missing, ambiguous } = parsePricingHeaders(sheet);
    if (missing.length)
      return patchValidation(missing.map((field) => ({ field, message: `Missing required pricing column: ${field}.` })));
    if (ambiguous.length)
      return patchValidation(ambiguous.map((field) => ({ field, message: `Only one '${field}' column is allowed.` })));
    const get = (row: ExcelJS.Row, name: Parameters<typeof valueAt>[2]) =>
      valueAt(row, columnMap, name);
    const raw: any[] = [],
      errors: { row: number; field?: string; message: string }[] = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      if (
        [...columnMap.values()].every(
          (column) => !text(row.getCell(column).value),
        )
      )
        continue;
      const supplier = text(get(row, "supplier")),
        manufacturer = text(get(row, "manufacturer")),
        partNumber = text(get(row, "partNumber")),
        supplierPartNumber = text(get(row, "supplierPartNumber")),
        description = text(get(row, "description")),
        rawPrice = text(get(row, "price"));
      const price = Number(rawPrice.replace(/,/g, "")),
        currencyValue = (text(get(row, "currency")) || "EGP").toUpperCase(),
        fromValue = get(row, "effectiveFrom"),
        parsedFrom = date(fromValue),
        // A stable undated baseline prevents every retry from becoming a new price version.
        from = parsedFrom || new Date("1970-01-01T00:00:00.000Z"),
        toValue = get(row, "effectiveTo"),
        to = toValue == null || !text(toValue) ? null : date(toValue);
      if (!supplier || (!partNumber && !supplierPartNumber && !description))
        errors.push({
          row: n,
          message:
            "Supplier and at least one of Part Number, Supplier SKU, or Description are required.",
        });
      else if (
        !rawPrice ||
        !Number.isFinite(price) ||
        price < 0 ||
        price >= 1e12
      )
        errors.push({
          row: n,
          field: "price",
          message: "Price must be a non-negative number.",
        });
      else if (fromValue != null && text(fromValue) && !parsedFrom)
        errors.push({
          row: n,
          field: "effective from",
          message: "Effective From is not a valid date.",
        });
      else if (!/^[A-Z]{3}$/.test(currencyValue))
        errors.push({
          row: n,
          field: "currency",
          message: "Currency must be a three-letter ISO code.",
        });
      else if (toValue != null && text(toValue) && !to)
        errors.push({
          row: n,
          field: "effective to",
          message: "Effective To is not a valid date.",
        });
      else if (to && to < from)
        errors.push({
          row: n,
          field: "effective to",
          message: "Effective To must not precede Effective From.",
        });
      else
        raw.push({
          row: n,
          supplier,
          manufacturer,
          partNumber,
          description,
          price,
          currency: currencyValue,
          supplierPartNumber: supplierPartNumber || null,
          unit: text(get(row, "unit")) || "NO",
          source: text(get(row, "source")) || `Excel import: ${file.name}`,
          active: !["false", "no", "0", "inactive"].includes(
            text(get(row, "active")).toLowerCase(),
          ),
          effectiveFrom: from,
          effectiveTo: to,
        });
    }
    if (!raw.length && !errors.length)
      return patchValidation([{ field: "file", message: "The XLSX file contains no pricing rows." }]);
    progress.stage = "preload-identities";
    const [suppliers, components] = await Promise.all([
      prisma.party.findMany({ where: { type: "SUPPLIER", deletedAt: null } }),
      prisma.component.findMany({ where: { active: true } }),
    ]);
    const supplierIds = new Map(
      suppliers.map((s) => [normalizePricingIdentity(s.companyName), s.id]),
    );
    const componentByIdentity = new Map(
      components.map((c) => [
        `${normalizePricingIdentity(c.manufacturer)}|${normalizePricingIdentity(c.partNumber)}`,
        c,
      ]),
    );
    const componentByPart = new Map<string, typeof components>();
    const componentByDescription = new Map<string, typeof components>();
    for (const component of components) {
      const part = normalizePricingIdentity(component.partNumber);
      const description = normalizePricingIdentity(component.description);
      componentByPart.set(part, [
        ...(componentByPart.get(part) ?? []),
        component,
      ]);
      componentByDescription.set(description, [
        ...(componentByDescription.get(description) ?? []),
        component,
      ]);
    }
    const seen = new Set<string>(),
      staged: any[] = [];
    const summary = {
      existingSuppliers: new Set<string>(),
      newSuppliers: new Set<string>(),
      existingComponents: new Set<string>(),
      newComponents: new Set<string>(),
      newPrices: 0,
      updatedPrices: 0,
    };
    for (const item of raw) {
      const supplierKey = normalizePricingIdentity(item.supplier),
        partKey = normalizePricingIdentity(
          item.partNumber || item.supplierPartNumber || item.description,
        ),
        manufacturerKey = normalizePricingIdentity(item.manufacturer),
        descriptionKey = normalizePricingIdentity(item.description);
      const componentKey = `${manufacturerKey}|${partKey}`;
      const partMatches = componentByPart.get(partKey) ?? [];
      const descriptionMatches = (
        componentByDescription.get(descriptionKey) ?? []
      ).filter(
        (c) =>
          !manufacturerKey ||
          normalizePricingIdentity(c.manufacturer) === manufacturerKey,
      );
      const component =
        componentByIdentity.get(componentKey) ??
        (partMatches.length === 1 ? partMatches[0] : undefined) ??
        (descriptionMatches.length === 1 ? descriptionMatches[0] : undefined);
      const duplicateKey = `${supplierKey}|${normalizePricingIdentity(item.supplierPartNumber || item.partNumber || item.description)}|${item.effectiveFrom.toISOString().slice(0, 10)}`;
      if (seen.has(duplicateKey))
        errors.push({
          row: item.row,
          field: "supplier part number",
          message:
            "Duplicate supplier SKU/part number for this supplier and effective date.",
        });
      else {
        seen.add(duplicateKey);
        if (supplierIds.has(supplierKey))
          summary.existingSuppliers.add(supplierKey);
        else summary.newSuppliers.add(supplierKey);
        if (component) summary.existingComponents.add(component.id);
        else summary.newComponents.add(componentKey);
        staged.push({
          ...item,
          supplierKey,
          componentKey,
          supplierId: supplierIds.get(supplierKey) ?? null,
          componentId: component?.id ?? null,
        });
      }
    }
    if (errors.length)
      return patchValidation(errors.map((issue) => ({
        field: `rows.${issue.row}.${issue.field ?? "identity"}`,
        message: issue.message,
      })));
    const mode =
      form.get("mode") === "replace"
        ? "replace"
        : form.get("mode") === "update"
          ? "update"
          : "append";
    if (mode === "replace" && form.get("confirmReplace") !== "true")
      return fail("Replacement requires explicit confirmation.", 400);
    const resultSummary = {
      existingSuppliers: summary.existingSuppliers.size,
      newSuppliers: summary.newSuppliers.size,
      existingComponents: summary.existingComponents.size,
      newComponents: summary.newComponents.size,
      newPrices: staged.length,
      updatedPrices: 0,
    };
    if (form.get("dryRun") === "true")
      return NextResponse.json({
        success: true,
        preview: true,
        message: "Import analysis completed. Confirm to make changes.",
        summary: resultSummary,
        created: 0,
        updated: 0,
        rejected: 0,
        errors: [],
      });
    total = staged.length;
    await writePricingImport(prisma, staged, mode, progress);
    const { created, updated } = progress;
    progress.stage = "audit";
    resultSummary.newPrices = created;
    resultSummary.updatedPrices = updated;
    await writeAuditLog({
      userId: guard.userId,
      action: "SUPPLIER_PRICE_IMPORTED",
      entity: "SupplierPrice",
      entityId: "bulk",
      newValue: { mode, ...resultSummary },
    });
    return NextResponse.json({
      success: true,
      imported: progress.imported,
      skipped: 0,
      failed: 0,
      message: `Imported ${created} and updated ${updated} price record(s).`,
      summary: resultSummary,
      created,
      updated,
      rejected: 0,
      errors: [],
    });
  } catch (e) {
    if (e instanceof ExcelError && e.status === 422)
      return patchValidation([{ field: "file", message: "The workbook could not be validated. Check that it contains a readable worksheet." }]);
    if (e instanceof ExcelError) return apiError(e, "pricing.validation");
    logPricingImportError(e, progress.stage);
    return NextResponse.json(
      {
        success: false,
        error:
          "Pricing import failed. Earlier batches may have committed; retrying the same file is safe.",
        stage: progress.stage,
        imported: progress.imported,
        created: progress.created,
        updated: progress.updated,
        skipped: 0,
        failed: total - progress.imported,
        partial: progress.imported > 0,
      },
      { status: 503 },
    );
  }
}
