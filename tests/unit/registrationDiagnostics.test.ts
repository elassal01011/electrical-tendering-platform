import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { registerCredentials } from "../../src/lib/auth/registration";
import { RegistrationDiagnostics } from "../../src/lib/auth/registrationDiagnostics";
import { registrationResponse } from "../../src/lib/auth/http";
import { allowSignup } from "../../src/lib/auth/rateLimit";
import { POST } from "../../src/app/api/auth/signup/route";
import { prisma } from "../../src/lib/db/prisma";

vi.mock("../../src/lib/db/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("../../src/lib/auth/credentialPolicy", async (original) => ({
  ...(await original<typeof import("../../src/lib/auth/credentialPolicy")>()),
  hashPassword: vi.fn().mockResolvedValue("test-generated-hash-sensitive"),
}));

const form = {
  name: "Test Engineer",
  username: "signup_test",
  email: "signup@example.test",
  password: "Secret-signup-password!",
  confirmPassword: "Secret-signup-password!",
};
function failure(
  code = "P2003",
  meta: Record<string, unknown> = {
    modelName: "AuditLog",
    field_name: "AuditLog_userId_fkey",
  },
) {
  return new Prisma.PrismaClientKnownRequestError(
    "Foreign key constraint failed",
    {
      code,
      meta,
      clientVersion: "5.18.0",
    },
  );
}
function fixture() {
  const tx = {
    user: { create: vi.fn().mockResolvedValue({ id: "created-user" }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
  };
  const db = {
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    role: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "standard-role", name: "E_SOLUTIONS_USER" }),
    },
    $transaction: vi.fn(async (action: (t: typeof tx) => Promise<unknown>) =>
      action(tx),
    ),
  };
  return { db, tx, client: db as unknown as PrismaClient };
}
const failures = () =>
  vi
    .mocked(console.error)
    .mock.calls.filter(([event]) => event === "auth.registration.failed")
    .map(([, payload]) => payload);

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("DEFAULT_SIGNUP_ROLE", "E_SOLUTIONS_USER");
  vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "false");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("registration failure diagnostics", () => {
  it.each([
    "EMAIL_LOOKUP",
    "USERNAME_LOOKUP",
    "ROLE_LOOKUP",
    "USER_CREATE",
    "AUDIT_WRITE",
    "TRANSACTION_BEGIN",
    "TRANSACTION_COMMIT",
  ])("preserves the original error and reports %s once", async (stage) => {
    const { db, tx, client } = fixture();
    const error = failure();
    if (stage === "EMAIL_LOOKUP")
      db.user.findFirst.mockRejectedValueOnce(error);
    if (stage === "USERNAME_LOOKUP")
      db.user.findFirst
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(error);
    if (stage === "ROLE_LOOKUP")
      db.role.findUnique.mockRejectedValueOnce(error);
    if (stage === "USER_CREATE") tx.user.create.mockRejectedValueOnce(error);
    if (stage === "AUDIT_WRITE")
      tx.auditLog.create.mockRejectedValueOnce(error);
    if (stage === "TRANSACTION_BEGIN")
      db.$transaction.mockRejectedValueOnce(error);
    if (stage === "TRANSACTION_COMMIT")
      db.$transaction.mockImplementationOnce(async (action) => {
        await action(tx);
        throw error;
      });
    const diagnostics = new RegistrationDiagnostics();
    await expect(registerCredentials(client, form, diagnostics)).rejects.toBe(
      error,
    );
    const response = registrationResponse(error, diagnostics);
    expect(await response.json()).toEqual({
      error: "Unable to create account.",
    });
    expect(response.status).toBe(503);
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      stage,
      name: "PrismaClientKnownRequestError",
      code: "P2003",
      meta: error.meta,
    });
    if (["EMAIL_LOOKUP", "USERNAME_LOOKUP", "ROLE_LOOKUP"].includes(stage))
      expect(db.$transaction).not.toHaveBeenCalled();
    if (stage === "USER_CREATE")
      expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("identifies a nested UserRole failure without separating the atomic create", async () => {
    const { tx, client } = fixture();
    tx.user.create.mockRejectedValueOnce(
      failure("P2003", { modelName: "UserRole", field_name: "roleId" }),
    );
    await expect(registerCredentials(client, form)).rejects.toThrow();
    expect(failures()[0]).toMatchObject({
      stage: "ROLE_ASSIGNMENT",
      code: "P2003",
    });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roles: { create: { roleId: "standard-role" } },
        }),
      }),
    );
  });

  it("logs P2002 before preserving the friendly duplicate response", async () => {
    const { db, tx, client } = fixture();
    db.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other-user" });
    tx.user.create.mockRejectedValueOnce(
      failure("P2002", { modelName: "User", target: ["email"] }),
    );
    await expect(registerCredentials(client, form)).rejects.toMatchObject({
      status: 409,
      message: "An account with this email already exists.",
    });
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      stage: "USER_CREATE",
      code: "P2002",
      meta: { target: ["email"] },
    });
  });

  it("diagnoses a missing default role without creating a user or changing the role", async () => {
    const { db, client } = fixture();
    db.role.findUnique.mockResolvedValueOnce(null);
    await expect(registerCredentials(client, form)).rejects.toMatchObject({
      status: 503,
    });
    expect(failures()[0]).toMatchObject({
      stage: "ROLE_LOOKUP",
      applicationReason: "DEFAULT_SIGNUP_ROLE_NOT_FOUND",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("preserves approval, nested role assignment, audit transaction and completion result", async () => {
    vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "true");
    const { db, tx, client } = fixture();
    expect(await registerCredentials(client, form)).toEqual({
      id: "created-user",
      pendingApproval: true,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: false,
          approvalPending: true,
          roles: { create: { roleId: "standard-role" } },
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "created-user",
        entity: "User",
        entityId: "created-user",
        action: "USER_SIGNUP",
      },
    });
    expect(vi.mocked(console.info).mock.calls).toContainEqual([
      "auth.registration.stage",
      expect.objectContaining({
        stage: "AUTO_LOGIN_PREPARATION",
        status: "completed",
      }),
    ]);
    expect(failures()).toHaveLength(0);
  });

  it.each([1, 2])(
    "reports failure in rate-limit write %s and keeps its error",
    async (write) => {
      const error = failure("P2024", { connection_limit: 1, timeout: 10 });
      const query = vi.fn().mockResolvedValue([{ count: 1 }]);
      if (write === 2) query.mockResolvedValueOnce([{ count: 1 }]);
      query.mockRejectedValueOnce(error);
      await expect(
        allowSignup(
          { $queryRaw: query } as unknown as PrismaClient,
          form.email,
          "test-ip",
        ),
      ).rejects.toBe(error);
      expect(failures()[0]).toMatchObject({
        stage: "LOGIN_ATTEMPT_WRITE",
        operation: write === 1 ? "signup_ip_limit" : "signup_email_limit",
        code: "P2024",
      });
      expect(query).toHaveBeenCalledTimes(write);
    },
  );

  it("keeps both independent rate limits enforced when the IP limit is exceeded", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ count: 11 }])
      .mockResolvedValueOnce([{ count: 1 }]);
    expect(
      await allowSignup(
        { $queryRaw: query } as unknown as PrismaClient,
        form.email,
        "test-ip",
      ),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("redacts connection credentials, passwords, hashes, tokens and unsafe metadata", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:db-sensitive-password@db.invalid:6543/postgres",
    );
    vi.stubEnv(
      "DIRECT_URL",
      "postgresql://user:direct-sensitive-password@db.invalid:5432/postgres",
    );
    vi.stubEnv("NEXTAUTH_SECRET", "nextauth-sensitive-secret");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-sensitive-secret");
    const diagnostics = new RegistrationDiagnostics();
    diagnostics.protect(form.password, "test-generated-hash-sensitive");
    const secretText = [
      form.password,
      "test-generated-hash-sensitive",
      process.env.DATABASE_URL,
      process.env.DIRECT_URL,
      "db-sensitive-password",
      "direct-sensitive-password",
      process.env.NEXTAUTH_SECRET,
      process.env.GOOGLE_CLIENT_SECRET,
      'access_token="oauth-sensitive-token"',
      'refresh_token="refresh-sensitive-token"',
      'id_token="id-sensitive-token"',
    ].join(" ");
    diagnostics.failed(
      failure("P2010", {
        code: "42P05",
        message: `prepared statement already exists ${secretText}`,
        query: secretText,
        password: form.password,
        nested: { secretText },
      }),
    );
    const log = JSON.stringify(failures());
    for (const secret of [
      form.password,
      "test-generated-hash-sensitive",
      "db-sensitive-password",
      "direct-sensitive-password",
      "nextauth-sensitive-secret",
      "google-sensitive-secret",
      "oauth-sensitive-token",
      "refresh-sensitive-token",
      "id-sensitive-token",
      "postgresql://",
    ])
      expect(log).not.toContain(secret);
    expect(failures()[0]).toMatchObject({
      code: "P2010",
      meta: { code: "42P05" },
      applicationReason: "PREPARED_STATEMENT_CONFLICT",
    });
    expect(failures()[0].meta).not.toHaveProperty("query");
  });

  it.each([
    ["P1001", "Cannot reach database", "DATABASE_UNREACHABLE"],
    ["P2024", "Timed out fetching a new connection", "CONNECTION_POOL_TIMEOUT"],
    ["P2010", "Max client connections reached", "CONNECTION_POOL_EXHAUSTED"],
    ["P2010", "invalid input value for enum RoleName", "ENUM_MISMATCH"],
  ])("classifies %s safely", (code, message, applicationReason) => {
    new RegistrationDiagnostics().failed(
      new Prisma.PrismaClientKnownRequestError(message, {
        code,
        clientVersion: "5.18.0",
      }),
    );
    expect(failures()[0]).toMatchObject({ code, message, applicationReason });
  });

  it("returns only a generic signup error when the first rate-limit query fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(
      failure("P2010", { message: form.password, code: "42P05" }),
    );
    const response = await POST(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: JSON.stringify(form),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Unable to create account.",
    });
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      stage: "LOGIN_ATTEMPT_WRITE",
      code: "P2010",
    });
    expect(JSON.stringify(failures())).not.toContain(form.password);
  });
});
