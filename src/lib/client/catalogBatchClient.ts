export const CATALOG_DATABASE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const CATALOG_DATABASE_MAX_ATTEMPTS = 3;

export type CatalogBatchState = {
  id: string;
  status: string;
  currentOffset: number;
  totalRows: number;
  batchSize: number;
  [key: string]: unknown;
};

export function createImportProcessingLock() {
  let active = false;
  return {
    isActive: () => active,
    async run(work: () => Promise<void>) {
      if (active) return false;
      active = true;
      try {
        await work();
        return true;
      } finally {
        active = false;
      }
    },
  };
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Retries only transient pool exhaustion and always reuses the same offset. */
export async function requestCatalogBatch(
  current: CatalogBatchState,
  fetcher: typeof fetch = fetch,
  delay: (milliseconds: number) => Promise<void> = wait,
  basePath = "/api/pricing/import",
) {
  for (let attempt = 1; attempt <= CATALOG_DATABASE_MAX_ATTEMPTS; attempt++) {
    const response = await fetcher(`${basePath}/${current.id}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: current.currentOffset,
        limit: current.batchSize,
      }),
    });
    const next = await response.json();
    if (response.ok) return next;
    if (
      next.error !== "DATABASE_BUSY" ||
      next.retryable !== true ||
      attempt >= CATALOG_DATABASE_MAX_ATTEMPTS
    )
      throw new Error(next.error || "Import batch failed.");
    await delay(CATALOG_DATABASE_RETRY_DELAYS_MS[attempt - 1]);
  }
  throw new Error("DATABASE_BUSY");
}
