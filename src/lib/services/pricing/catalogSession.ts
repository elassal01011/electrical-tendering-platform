import { z } from "zod";

export const CATALOG_REQUEST_BATCH_SIZE = 100;

const stagedValue = z.object({
  supplier: z.string(),
  supplierPartNumber: z.string().nullable(),
  manufacturer: z.string(),
  partNumber: z.string(),
  description: z.string(),
  price: z.number(),
  currency: z.string(),
  unit: z.string(),
  source: z.string(),
  active: z.boolean(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
});

export const catalogSessionRowSchema = z.object({
  row: z.number().int().positive(),
  classification: z.enum(["VALID_PRICE", "NO_PRICE", "INVALID_PRICE"]),
  message: z.string(),
  values: stagedValue,
});

export const catalogSessionSchema = z.object({
  type: z.literal("PRICE_CATALOG"),
  status: z.enum(["READY", "IMPORTING", "COMPLETED", "FAILED", "CANCELLED"]),
  fileName: z.string(),
  sheetName: z.string(),
  headerRow: z.number().int().nonnegative(),
  mapping: z.record(z.string(), z.number().int().positive()),
  mode: z.enum(["update", "skip", "revision"]),
  rows: z.array(catalogSessionRowSchema),
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  createdRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  noPriceRows: z.number().int().nonnegative(),
  reviewRows: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  currentOffset: z.number().int().nonnegative(),
  skippedReport: z.array(z.object({ row: z.number(), message: z.string() })),
  reviewReport: z.array(z.object({ row: z.number(), message: z.string() })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string(),
  lastError: z.string().nullable().optional(),
  leaseToken: z.string().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
});

export type CatalogSession = z.infer<typeof catalogSessionSchema>;

export function stageCatalogSession(
  fileName: string,
  sheetName: string,
  headerRow: number,
  mapping: Record<string, number>,
  mode: CatalogSession["mode"],
  createdBy: string,
  rows: Array<{
    row: number;
    classification: CatalogSession["rows"][number]["classification"];
    message: string;
    values: Omit<
      CatalogSession["rows"][number]["values"],
      "effectiveFrom" | "effectiveTo"
    > & {
      effectiveFrom: Date;
      effectiveTo: Date | null;
    };
  }>,
): CatalogSession {
  const now = new Date().toISOString();
  const stagedRows = rows.map((item) => ({
    ...item,
    values: {
      ...item.values,
      effectiveFrom: item.values.effectiveFrom.toISOString(),
      effectiveTo: item.values.effectiveTo?.toISOString() ?? null,
    },
  }));
  return {
    type: "PRICE_CATALOG",
    status: "READY",
    fileName,
    sheetName,
    headerRow,
    mapping,
    mode,
    rows: stagedRows,
    totalRows: stagedRows.length,
    processedRows: 0,
    importedRows: 0,
    createdRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    noPriceRows: 0,
    reviewRows: 0,
    failedRows: 0,
    currentOffset: 0,
    skippedReport: [],
    reviewReport: [],
    createdAt: now,
    updatedAt: now,
    createdBy,
    leaseToken: null,
    leaseExpiresAt: null,
  };
}

export function publicCatalogSession(id: string, session: CatalogSession) {
  const {
    rows: _rows,
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    createdBy: _createdBy,
    ...safe
  } = session;
  return {
    id,
    ...safe,
    batchRunning: Boolean(session.leaseToken),
    batchSize: CATALOG_REQUEST_BATCH_SIZE,
  };
}
