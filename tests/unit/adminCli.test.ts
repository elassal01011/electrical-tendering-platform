import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  disconnect: vi.fn(),
  create: vi.fn(),
  dotenv: vi.fn(),
}));
vi.mock("dotenv", () => ({ config: state.dotenv }));
vi.mock("@prisma/client", () => ({
  PrismaClient: function (options: unknown) {
    state.create(options);
    return { $disconnect: state.disconnect };
  },
}));
import { runAdminCommand } from "../../scripts/admin-cli";
import { AdminCommandError } from "../../src/lib/auth/admin";
let originalExitCode: typeof process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  originalExitCode = process.exitCode;
  vi.stubEnv("DIRECT_URL", "postgresql://test-only@localhost:5432/test");
  vi.stubEnv("DATABASE_URL", "postgresql://unused@localhost:6543/unused");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("loads dotenv quietly and explicitly uses DIRECT_URL instead of runtime DATABASE_URL", async () => {
  const action = vi.fn();
  await runAdminCommand(action);
  expect(state.dotenv).toHaveBeenCalledWith({ quiet: true });
  expect(state.create).toHaveBeenCalledWith({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });
  expect(action).toHaveBeenCalledOnce();
  expect(state.disconnect).toHaveBeenCalledOnce();
});
it("requires DIRECT_URL and never falls back to the runtime connection", async () => {
  vi.stubEnv("DIRECT_URL", "");
  const action = vi.fn();
  await runAdminCommand(action);
  expect(console.error).toHaveBeenCalledWith(
    "Set DIRECT_URL before running this administrative command.",
  );
  expect(state.create).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
it("suppresses raw database errors, fails the command, and still disconnects", async () => {
  await runAdminCommand(async () => {
    throw new Error("postgresql://secret:password@private-host");
  });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /private-host|secret:password/,
  );
  expect(state.disconnect).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});
it("prints only deliberately safe administrative errors", async () => {
  await runAdminCommand(async () => {
    throw new AdminCommandError("Admin user was not found.");
  });
  expect(console.error).toHaveBeenCalledWith("Admin user was not found.");
  expect(state.disconnect).toHaveBeenCalledOnce();
});
