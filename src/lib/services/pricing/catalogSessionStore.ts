import { Prisma, type PrismaClient } from "@prisma/client";
import {
  catalogSessionRowSchema,
  catalogSessionSchema,
  type CatalogSession,
} from "./catalogSession";

/** Reads session metadata without transferring the staged row array. */
export async function readCatalogSession(
  db: PrismaClient,
  id: string,
  userId: string,
) {
  const result = await db.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
    SELECT "extractedData" - 'rows' AS data
    FROM "ExcelUpload"
    WHERE id = ${id} AND "userId" = ${userId} AND "expiresAt" > NOW()
    LIMIT 1
  `);
  return result[0]
    ? catalogSessionSchema.parse({ ...(result[0].data as object), rows: [] })
    : null;
}

/** PostgreSQL slices the JSON array; Node receives only this request's rows. */
export async function readCatalogSessionRows(
  db: PrismaClient,
  id: string,
  userId: string,
  offset: number,
  limit: number,
) {
  const result = await db.$queryRaw<Array<{ rows: unknown }>>(Prisma.sql`
    SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb) AS rows
    FROM "ExcelUpload",
      jsonb_array_elements("extractedData"->'rows') WITH ORDINALITY AS entry(value, ordinality)
    WHERE id = ${id} AND "userId" = ${userId} AND "expiresAt" > NOW()
      AND entry.ordinality > ${offset}
      AND entry.ordinality <= ${offset + limit}
  `);
  return catalogSessionRowSchema.array().parse(result[0]?.rows ?? []);
}

/** Merges progress fields without reading or rewriting the staged row array. */
export async function mergeCatalogSession(
  db: PrismaClient,
  id: string,
  userId: string,
  patch: Partial<Omit<CatalogSession, "rows">>,
  condition?: { leaseToken?: string | null; currentOffset?: number },
) {
  const value = JSON.stringify(patch);
  const lease =
    condition?.leaseToken === undefined
      ? Prisma.empty
      : condition.leaseToken === null
        ? Prisma.sql`AND "extractedData"->'leaseToken' = 'null'::jsonb`
        : Prisma.sql`AND "extractedData"->>'leaseToken' = ${condition.leaseToken}`;
  const offset =
    condition?.currentOffset === undefined
      ? Prisma.empty
      : Prisma.sql`AND ("extractedData"->>'currentOffset')::int = ${condition.currentOffset}`;
  return db.$executeRaw(Prisma.sql`
    UPDATE "ExcelUpload"
    SET "extractedData" = "extractedData" || ${value}::jsonb
    WHERE id = ${id} AND "userId" = ${userId} AND "expiresAt" > NOW()
      ${lease} ${offset}
  `);
}
