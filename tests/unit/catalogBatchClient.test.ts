import { describe, expect, it, vi } from "vitest";
import {
  createImportProcessingLock,
  requestCatalogBatch,
} from "../../src/lib/client/catalogBatchClient";

const current = {
  id: "session-1",
  status: "IMPORTING",
  currentOffset: 1200,
  totalRows: 4000,
  batchSize: 100,
};

describe("catalog batch client", () => {
  it("retries P2024 at the same offset with bounded exponential backoff", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "DATABASE_BUSY", retryable: true }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "DATABASE_BUSY", retryable: true }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ ...current, currentOffset: 1300 }));
    const delay = vi.fn().mockResolvedValue(undefined);

    expect(await requestCatalogBatch(current, fetcher, delay)).toMatchObject({
      currentOffset: 1300,
    });
    expect(delay.mock.calls).toEqual([[1000], [2000]]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).offset),
    ).toEqual([1200, 1200, 1200]);
  });

  it("does not retry validation or lock errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        { error: "IMPORT_BATCH_ALREADY_PROCESSING", retryable: true },
        { status: 409 },
      ),
    );
    await expect(requestCatalogBatch(current, fetcher, vi.fn())).rejects.toThrow(
      "IMPORT_BATCH_ALREADY_PROCESSING",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("permits only one active processing loop", async () => {
    const lock = createImportProcessingLock();
    let release!: () => void;
    const first = lock.run(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const duplicate = await lock.run(async () => undefined);
    expect(duplicate).toBe(false);
    expect(lock.isActive()).toBe(true);
    release();
    expect(await first).toBe(true);
    expect(lock.isActive()).toBe(false);
  });
});
