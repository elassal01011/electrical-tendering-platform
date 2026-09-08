import { z } from "zod";
import type { ComponentImportRow } from "./componentImport";

export const COMPONENT_IMPORT_BATCH_SIZE = 100;
const rowSchema = z.object({
  row: z.number().int().positive(),
  classification: z.enum(["VALID_COMPONENT", "INCOMPLETE", "INVALID"]),
  message: z.string(),
  values: z.object({
    manufacturer: z.string(), partNumber: z.string(), description: z.string(), category: z.string(),
    voltageV: z.number().nullable(), currentA: z.number().nullable(), poles: z.number().nullable(),
    breakingCapacityKA: z.number().nullable(), tripUnit: z.string().nullable(), mounting: z.string().nullable(),
    active: z.boolean(), tags: z.array(z.string()),
  }),
});
export const componentSessionSchema = z.object({
  type: z.literal("COMPONENT_CATALOG"),
  status: z.enum(["READY", "IMPORTING", "COMPLETED", "FAILED", "CANCELLED"]),
  fileName: z.string(), sheetName: z.string(), headerRow: z.number().int().positive(),
  mapping: z.record(z.string(), z.number().int().positive()),
  duplicateMode: z.enum(["UPDATE_EXISTING", "SKIP_EXISTING", "CREATE_NEW"]),
  rows: z.array(rowSchema), totalRows: z.number().int().nonnegative(), currentOffset: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(), importedRows: z.number().int().nonnegative(),
  createdRows: z.number().int().nonnegative(), updatedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(), incompleteRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(), report: z.array(z.object({ row: z.number(), classification: z.string(), message: z.string() })),
  createdBy: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  leaseToken: z.string().nullable(), leaseExpiresAt: z.string().datetime().nullable(), lastError: z.string().nullable().optional(),
});
export type ComponentSession = z.infer<typeof componentSessionSchema>;
export const createComponentSession = (
  metadata: Pick<ComponentSession, "fileName" | "sheetName" | "headerRow" | "mapping" | "duplicateMode" | "createdBy">,
  rows: ComponentImportRow[],
): ComponentSession => {
  const now = new Date().toISOString();
  return {
    type: "COMPONENT_CATALOG", status: "READY", ...metadata, rows,
    totalRows: rows.length, currentOffset: 0, processedRows: 0, importedRows: 0,
    createdRows: 0, updatedRows: 0, skippedRows: 0, incompleteRows: 0, invalidRows: 0,
    report: [], createdAt: now, updatedAt: now, leaseToken: null, leaseExpiresAt: null,
  };
};
export function publicComponentSession(id: string, session: ComponentSession) {
  const { rows: _rows, createdBy: _createdBy, leaseToken: _lease, leaseExpiresAt: _expiry, ...safe } = session;
  return { id, ...safe, batchSize: COMPONENT_IMPORT_BATCH_SIZE, batchRunning: Boolean(session.leaseToken) };
}
export { rowSchema as componentSessionRowSchema };
