import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logGenericExcelError,
  prismaErrorCode,
} from "../../src/lib/services/excel/genericDiagnostics";

describe("generic Excel pool diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the failing stage and whitelisted P2024 metadata without secrets", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(
      new Error("Timed out at postgresql://user:password@private-host/database"),
      { code: "P2024", meta: { connection_limit: 1, timeout: 10 } },
    );

    logGenericExcelError(error, "load-upload");

    expect(log).toHaveBeenCalledWith("excel.generic", {
      stage: "load-upload",
      name: "Error",
      code: "P2024",
      message: "Timed out at [REDACTED_URL]",
      meta: { connection_limit: 1, timeout: 10 },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("password");
  });

  it("does not emit pool diagnostics for unrelated errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(prismaErrorCode({ code: "P2028" })).toBe("P2028");
    logGenericExcelError(Object.assign(new Error("invalid"), { code: "P2028" }), "parse-workbook");
    expect(log).not.toHaveBeenCalled();
  });
});
