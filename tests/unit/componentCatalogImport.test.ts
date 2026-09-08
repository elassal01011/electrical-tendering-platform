import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { ExtractedSheet } from "../../src/lib/services/excel/extractWorkbook";

const state = vi.hoisted(() => ({
  session: null as any,
  components: [] as any[],
  claims: 0,
  transactions: [] as number[],
  deny: false,
}));
vi.mock("@/lib/auth/apiGuard", () => ({
  requirePermission: async () => state.deny
    ? { error: NextResponse.json({ error: "Denied" }, { status: 403 }) }
    : { userId: "u" },
  writeAuditLog: async () => undefined,
}));
vi.mock("@/lib/services/components/componentSessionStore", () => ({
  readComponentSession: async () => state.session ? { ...state.session, rows: [] } : null,
  readComponentRows: async (_db: unknown, _id: string, _user: string, offset: number, limit: number) =>
    state.session.rows.slice(offset, offset + limit),
  mergeComponentSession: async (
    _db: unknown, _id: string, _user: string, patch: any,
    condition?: { leaseToken?: string | null; currentOffset?: number },
  ) => {
    if (condition?.leaseToken !== undefined && state.session.leaseToken !== condition.leaseToken) return 0;
    if (condition?.currentOffset !== undefined && state.session.currentOffset !== condition.currentOffset) return 0;
    if (patch.leaseToken) state.claims++;
    Object.assign(state.session, patch);
    return 1;
  },
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    component: {
      findMany: async () => state.components,
      update: ({ where, data }: any) => () => {
        Object.assign(state.components.find((value) => value.id === where.id), data);
      },
      createMany: ({ data }: any) => () => {
        for (const component of data)
          if (!state.components.some((value) => value.id === component.id))
            state.components.push(component);
      },
    },
    $transaction: async (operations: Array<() => unknown>) => {
      state.transactions.push(operations.length);
      expect(operations.length).toBeLessThanOrEqual(100);
      for (const operation of operations) operation();
    },
  },
}));

import {
  analyzeComponentSheet,
  classifyComponentRows,
} from "../../src/lib/services/components/componentImport";
import { createComponentSession } from "../../src/lib/services/components/componentSession";
import { POST as processBatch } from "../../src/app/api/components/import/[sessionId]/batch/route";

function sheet(count = 1): ExtractedSheet {
  return {
    name: "ABB Catalog",
    rowCount: count + 4,
    columnCount: 6,
    merges: [],
    detectedHeaderRow: 4,
    headerConfidence: 96,
    rows: [
      {
        rowNumber: 4,
        cells: ["Vendor Brand", "Ordering Code", "Product Description", "Ampere", "No. of Poles", "Icu"].map((value, index) => ({
          column: index + 1, columnLetter: String.fromCharCode(65 + index), value, type: "string",
        })),
      },
      ...Array.from({ length: count }, (_, index) => ({
        rowNumber: index + 5,
        cells: ["ABB", `1SDA-${index}`, `MCCB Tmax ${index}`, "250 A", "4P", "36 kA"].map((value, cell) => ({
          column: cell + 1, columnLetter: String.fromCharCode(65 + cell), value, type: "string",
        })),
      })),
    ],
  };
}
const mapping = {
  manufacturer: 1, partNumber: 2, description: 3,
  ratedCurrent: 4, poles: 5, breakingCapacity: 6,
};
const context = { params: Promise.resolve({ sessionId: "component-session" }) };

beforeEach(() => {
  state.session = null;
  state.components = [];
  state.claims = 0;
  state.transactions = [];
  state.deny = false;
});

describe("component catalog Excel import", () => {
  it("recognizes arbitrary ABB headers below row one and previews their mapping", () => {
    const analysis = analyzeComponentSheet(sheet(), 4);
    expect(analysis.headerRow).toBe(4);
    expect(analysis.mapping).toMatchObject({
      manufacturer: 1,
      partNumber: 2,
      description: 3,
      ratedCurrent: 4,
      poles: 5,
      breakingCapacity: 6,
    });
  });

  it("classifies valid, incomplete, and nuisance rows independently", () => {
    const input = sheet();
    input.rows.push(
      { rowNumber: 6, cells: [{ column: 3, columnLetter: "C", value: "MCCB marketing overview", type: "string" }] },
      { rowNumber: 7, cells: [{ column: 3, columnLetter: "C", value: "Total products", type: "string" }] },
    );
    input.rowCount = 7;
    expect(classifyComponentRows(input, 4, mapping).map((row) => row.classification)).toEqual([
      "VALID_COMPONENT", "INVALID", "INVALID",
    ]);
  });

  it("imports 4000 components through forty resumable 100-row claims", async () => {
    const rows = classifyComponentRows(sheet(4000), 4, mapping);
    state.session = createComponentSession({
      fileName: "abb.xlsx", sheetName: "ABB Catalog", headerRow: 4,
      mapping, duplicateMode: "UPDATE_EXISTING", createdBy: "u",
    }, rows);
    while (state.session.status !== "COMPLETED") {
      const response = await processBatch(new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: state.session.currentOffset, limit: 100 }),
      }), context);
      expect(response.status).toBe(200);
    }
    expect(state.session).toMatchObject({ status: "COMPLETED", processedRows: 4000, importedRows: 4000 });
    expect(state.claims).toBe(40);
    expect(state.components).toHaveLength(4000);
    expect(state.transactions).toHaveLength(40);
  }, 15000);

  it("updates a normalized manufacturer and part-number duplicate", async () => {
    const rows = classifyComponentRows(sheet(), 4, mapping);
    state.components = [{
      id: "existing", manufacturer: "abb", partNumber: "1sda-0",
      description: "Old", category: "MCCB", active: true, tags: [],
    }];
    state.session = createComponentSession({
      fileName: "abb.xlsx", sheetName: "ABB Catalog", headerRow: 4,
      mapping, duplicateMode: "UPDATE_EXISTING", createdBy: "u",
    }, rows);
    const response = await processBatch(new NextRequest("http://localhost/batch", {
      method: "POST", body: JSON.stringify({ offset: 0, limit: 100 }),
    }), context);
    expect(response.status).toBe(200);
    expect(state.components).toHaveLength(1);
    expect(state.components[0].description).toBe("MCCB Tmax 0");
  });

  it("blocks unauthorized component batch processing", async () => {
    state.deny = true;
    const response = await processBatch(new NextRequest("http://localhost/batch", {
      method: "POST", body: JSON.stringify({ offset: 0, limit: 100 }),
    }), context);
    expect(response.status).toBe(403);
    expect(state.transactions).toHaveLength(0);
  });
});
