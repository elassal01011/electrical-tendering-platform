import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { randomBytes } from "node:crypto";
const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => auth.session),
}));
import { prisma } from "../../src/lib/db/prisma";
import { authOptions } from "../../src/lib/auth/authOptions";
import * as uploads from "../../src/app/api/boq/excel/upload/route";
import * as previews from "../../src/app/api/boq/excel/preview/route";
import * as imports from "../../src/app/api/boq/excel/import/route";
import * as match from "../../src/app/api/boq/[id]/match/route";
import * as review from "../../src/app/api/boq/items/[id]/route";
import * as pricing from "../../src/app/api/boq/[id]/apply-prices/route";
import * as quotes from "../../src/app/api/quotes/route";
import * as quote from "../../src/app/api/quotes/[id]/route";
import * as approval from "../../src/app/api/quotes/[id]/approve/route";
import * as exports from "../../src/app/api/quotes/[id]/export/route";
import * as documents from "../../src/app/api/documents/route";
import * as document from "../../src/app/api/documents/[id]/route";
const enabled =
  process.env.VERIFY_DATABASE === "true" &&
  process.env.DATABASE_URL?.includes("127.0.0.1:55439/esolutions_verification");
const request = (path: string, body?: unknown, method = "POST") =>
  new NextRequest("http://localhost" + path, {
    method,
    headers:
      body instanceof Uint8Array
        ? { "Content-Type": "application/octet-stream" }
        : body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body instanceof Uint8Array
          ? new Blob([body])
          : body === undefined
            ? undefined
            : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}
describe.skipIf(!enabled)(
  "isolated database workflow (real routes and fresh RBAC; session retrieval is mocked)",
  () => {
    afterAll(() => prisma.$disconnect());
    it("imports a large workbook, reviews engineering, prices, approves, revises and protects documents", async () => {
      const nonce = Date.now();
      const hash = await bcrypt.hash("Verification-only-password", 10);
      const users: User[] = [];
      for (const name of [
        "SUPER_ADMIN",
        "GENERAL_MANAGER",
        "SALES_ENGINEER",
      ] as const) {
        const role = await prisma.role.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        users.push(
          await prisma.user.create({
            data: {
              email: name + nonce + "@example.test",
              name,
              passwordHash: hash,
              roles: { create: { roleId: role.id } },
            },
          }),
        );
      }
      const session = (i: number) => ({
        user: { id: users[i].id, roles: [], sessionVersion: 0 },
      });
      const authorize = (authOptions.providers[0] as any).options.authorize;
      const credentials = {
        email: users[0].email,
        password: "Verification-only-password",
      };
      expect((await authorize(credentials)).id).toBe(users[0].id);
      for (let i = 0; i < 8; i++)
        expect(
          await authorize({ ...credentials, password: "incorrect" }),
        ).toBeNull();
      expect(await authorize(credentials)).toBeNull();
      auth.session = null;
      expect((await uploads.GET()).status).toBe(401);
      auth.session = session(2);
      expect((await uploads.GET()).status).toBe(403);
      auth.session = session(0);
      const client = await prisma.party.create({
        data: { type: "CLIENT", companyName: "Verification client " + nonce },
      });
      const project = await prisma.project.create({
        data: {
          name: "Verification tender",
          code: "VERIFY-" + nonce,
          clientId: client.id,
        },
      });
      await prisma.component.create({
        data: {
          manufacturer: "Schneider Electric",
          partNumber: "TEST-" + nonce,
          description: "250A MCCB 4P 36kA 415V",
          category: "MCCB",
          currentA: 250,
          poles: 4,
          breakingCapacityKA: 36,
          voltageV: 415,
          listPrice: 100,
          listPriceCurrency: "EGP",
          tags: [],
        },
      });
      const wb = new ExcelJS.Workbook(),
        ws = wb.addWorksheet("BOQ");
      ws.getRow(5).values = ["Item No.", "ITEM DESCRIPTION", "", "QTY.", "UOM"];
      ws.getRow(6).values = [
        "1",
        "250A MCCB 4P 36kA 415V Schneider",
        "",
        "10 Nos",
        "NO",
      ];
      ws.mergeCells("B6:C6");
      ws.getRow(7).values = [
        "2",
        "250A MCCB 4P 36kA 415V Schneider",
        "",
        { formula: "2*5", result: 10 },
        "NO",
      ];
      ws.getRow(8).values = ["3", "Review row", "", "TBC", "NO"];
      const volume = wb.addWorksheet("Reference");
      for (let i = 0; i < 18000; i++)
        volume.addRow([randomBytes(300).toString("hex")]);
      const bytes = Buffer.from(
        (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer,
      );
      expect(bytes.length).toBeGreaterThan(4.5 * 1024 * 1024);
      expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
      const upload = await json(
        await uploads.POST(
          request("/api/boq/excel/upload", {
            name: "Verification.xlsx",
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: bytes.length,
          }),
        ),
        201,
      );
      for (let offset = 0; offset < bytes.length; offset += upload.chunkBytes)
        await json(
          await uploads.PUT(
            request(
              "/api/boq/excel/upload?uploadId=" +
                upload.uploadId +
                "&index=" +
                offset / upload.chunkBytes,
              new Uint8Array(
                bytes.subarray(offset, offset + upload.chunkBytes),
              ),
              "PUT",
            ),
          ),
        );
      const config = {
        sheetName: "BOQ",
        headerRow: 5,
        mapping: { itemNumber: 1, description: 2, quantity: 4, unit: 5 },
      };
      const preview = await json(
        await previews.POST(
          request("/api/boq/excel/preview", {
            uploadId: upload.uploadId,
            config,
          }),
        ),
      );
      expect(preview.summary.validRows).toBe(2);
      expect(preview.summary.reviewRows).toBe(1);
      const input = {
        uploadId: upload.uploadId,
        config: {
          ...config,
          projectId: project.id,
          name: "Verification BOQ",
          skipReviewRows: true,
        },
      };
      const imported = await json(
        await imports.POST(request("/api/boq/excel/import", input)),
        201,
      );
      const retry = await json(
        await imports.POST(request("/api/boq/excel/import", input)),
      );
      expect(retry.boq.id).toBe(imported.boq.id);
      expect(retry.repeated).toBe(true);
      await json(await match.POST(request("/match"), params(imported.boq.id)));
      const items = await prisma.bOQItem.findMany({
        where: { boqId: imported.boq.id },
      });
      for (const item of items) {
        expect(item.status).toBe("SUGGESTED");
        expect(item.matchedComponentId).toBeTruthy();
        await json(
          await review.PATCH(
            request(
              "/review",
              {
                componentId: item.matchedComponentId,
                notes: "Required ratings verified by engineer.",
              },
              "PATCH",
            ),
            params(item.id),
          ),
        );
      }
      await json(
        await pricing.POST(request("/prices", {}), params(imported.boq.id)),
      );
      expect(
        (
          await prisma.bOQItem.findMany({ where: { boqId: imported.boq.id } })
        ).every((i) => Number(i.appliedUnitPrice) === 100),
      ).toBe(true);
      const quoteInput = {
        projectId: project.id,
        currency: "EGP",
        validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        discountPct: 5,
        vatPct: 14,
        terms: { payment: "30 days", warranty: "12 months" },
        items: [
          {
            description: "Verified circuit breakers",
            quantity: 20,
            unitCost: 100,
            unitSell: 150,
            unit: "NO",
          },
        ],
      };
      const created = await json(
        await quotes.POST(request("/api/quotes", quoteInput)),
        201,
      );
      auth.session = session(2);
      const customer = await json(
        await quote.GET(
          request("/quote", undefined, "GET"),
          params(created.quote.id),
        ),
      );
      expect(JSON.stringify(customer)).not.toContain("unitCost");
      expect(JSON.stringify(customer)).not.toContain("marginPct");
      expect(
        (
          await quote.GET(
            request("/quote?view=internal", undefined, "GET"),
            params(created.quote.id),
          )
        ).status,
      ).toBe(403);
      auth.session = session(0);
      await json(
        await approval.POST(
          request("/approve", { action: "submit" }),
          params(created.quote.id),
        ),
      );
      expect(
        (
          await approval.POST(
            request("/approve", { action: "approve" }),
            params(created.quote.id),
          )
        ).status,
      ).toBe(403);
      auth.session = session(1);
      await json(
        await approval.POST(
          request("/approve", { action: "approve" }),
          params(created.quote.id),
        ),
      );
      auth.session = session(0);
      expect(
        (
          await quote.PATCH(
            request("/quote", quoteInput, "PATCH"),
            params(created.quote.id),
          )
        ).status,
      ).toBe(409);
      const revision = await json(
        await quote.POST(request("/quote"), params(created.quote.id)),
        201,
      );
      expect(revision.quote.revision).toBe(2);
      expect(revision.quote.status).toBe("DRAFT");
      auth.session = session(2);
      const excel = await exports.GET(
        request("/export", undefined, "GET"),
        params(created.quote.id),
      );
      expect(excel.status).toBe(200);
      const exported = new ExcelJS.Workbook();
      await exported.xlsx.load(Buffer.from(await excel.arrayBuffer()));
      let text = "";
      exported.worksheets[0].eachRow((r) => {
        text += JSON.stringify(r.values);
      });
      expect(text).not.toContain("Unit cost");
      auth.session = session(0);
      async function uploadDoc() {
        const fd = new FormData();
        fd.append("projectId", project.id);
        fd.append("category", "Tender Documents");
        fd.append(
          "file",
          new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
          "Verification.pdf",
        );
        return json(await documents.POST(request("/api/documents", fd)), 201);
      }
      const first = await uploadDoc(),
        second = await uploadDoc();
      expect(second.version).toBe(first.version + 1);
      auth.session = null;
      expect(
        (
          await document.GET(
            request("/document", undefined, "GET"),
            params(first.id),
          )
        ).status,
      ).toBe(401);
      auth.session = session(0);
      expect(
        (
          await document.GET(
            request("/document", undefined, "GET"),
            params(first.id),
          )
        ).status,
      ).toBe(200);
      await prisma.user.update({
        where: { id: users[0].id },
        data: { sessionVersion: { increment: 1 } },
      });
      expect((await uploads.GET()).status).toBe(401);
      console.log(
        "Verified workbook size: " +
          (bytes.length / 1024 / 1024).toFixed(2) +
          " MB; document and quote revisions; session revocation.",
      );
    }, 120000);
  },
);
