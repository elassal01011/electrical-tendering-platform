import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/apiGuard", () => ({ requirePermission: mocks.guard }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
import { POST as createBoq } from "../../src/app/api/boq/route";
import { POST as createItem } from "../../src/app/api/boq/[id]/items/route";
import {
  PUT as updateItem,
  DELETE as deleteItem,
} from "../../src/app/api/boq/items/[id]/route";
import { applyCreatedBoq } from "../../src/lib/client/boqWorkflow";

const request = (body: object, method = "POST") =>
  new Request("http://localhost/api/boq", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const item = {
  itemNumber: "1",
  description: "MCCB 250A",
  quantity: 4,
  unit: "EA",
  manufacturer: "Schneider",
  model: "",
  remarks: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "user" });
});

describe("manual BOQ management", () => {
  it.each([401, 403])(
    "prevents unauthorized BOQ creation (%s)",
    async (status) => {
      mocks.guard.mockResolvedValue({
        error: NextResponse.json({ error: "Denied" }, { status }),
      });
      expect((await createBoq(request({}))).status).toBe(status);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("creates the first blank BOQ for a project with server-owned audit identity", async () => {
    const tx = {
      project: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "project", currency: "EGP" }),
      },
      bOQ: {
        create: vi
          .fn()
          .mockResolvedValue({
            id: "boq",
            projectId: "project",
            name: "Main",
            version: 0,
            currency: "EGP",
            items: [],
          }),
      },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation((callback: any) => callback(tx));
    const response = await createBoq(
      request({
        projectId: "project",
        name: "Main",
        description: "LV",
        revision: "0",
        currency: "EGP",
        createdBy: "attacker",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.boq.items).toEqual([]);
    expect(tx.bOQ.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "project", version: 0 }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user", action: "BOQ_CREATED" }),
    });
  });
  it("refreshes a zero-BOQ list and automatically selects the created BOQ", () => {
    expect(applyCreatedBoq([], { id: "first", name: "First" })).toEqual({
      boqs: [{ id: "first", name: "First" }],
      selectedBoqId: "first",
    });
  });
  it("manually adds an item and records its audit event", async () => {
    const tx = {
      bOQ: { findUnique: vi.fn().mockResolvedValue({ id: "boq" }) },
      bOQItem: {
        aggregate: vi.fn().mockResolvedValue({ _max: { lineNo: 2 } }),
        create: vi.fn().mockResolvedValue({ id: "item", boqId: "boq" }),
      },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation((callback: any) => callback(tx));
    expect(
      (
        await createItem(request(item), {
          params: Promise.resolve({ id: "boq" }),
        })
      ).status,
    ).toBe(201);
    expect(tx.bOQItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lineNo: 3,
          rawDescription: item.description,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "BOQ_ITEM_CREATED" }),
    });
  });
  it("edits an item and records its audit event", async () => {
    const tx = {
      bOQItem: {
        findUnique: vi.fn().mockResolvedValue({ id: "item", boqId: "boq" }),
        update: vi.fn().mockResolvedValue({ id: "item" }),
      },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation((callback: any) => callback(tx));
    expect(
      (
        await updateItem(request({ ...item, quantity: 5 }, "PUT"), {
          params: Promise.resolve({ id: "item" }),
        })
      ).status,
    ).toBe(200);
    expect(tx.bOQItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 5 }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "BOQ_ITEM_UPDATED" }),
    });
  });
  it("deletes an item only through the explicit delete endpoint and audits it", async () => {
    const tx = {
      bOQItem: {
        findUnique: vi.fn().mockResolvedValue({ id: "item", boqId: "boq" }),
        delete: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation((callback: any) => callback(tx));
    expect(
      (
        await deleteItem(request({}, "DELETE"), {
          params: Promise.resolve({ id: "item" }),
        })
      ).status,
    ).toBe(200);
    expect(tx.bOQItem.delete).toHaveBeenCalledWith({ where: { id: "item" } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "BOQ_ITEM_DELETED" }),
    });
  });
});
