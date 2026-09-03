import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
const callbackDb = vi.hoisted(() => ({
  $transaction: vi.fn(),
  auditLog: { create: vi.fn() },
}));
vi.mock("../../src/lib/db/prisma", () => ({ prisma: callbackDb }));
import { authOptions } from "../../src/lib/auth/authOptions";
import { signInGoogle } from "../../src/lib/auth/google";
import {
  GoogleDiagnostics,
  safeGoogleError,
} from "../../src/lib/auth/googleDiagnostics";

const profile = {
  sub: "google-subject-test",
  email: "private@example.test",
  email_verified: true,
  name: "Test User",
};
let errorLog: ReturnType<typeof vi.spyOn>,
  infoLog: ReturnType<typeof vi.spyOn>,
  warnLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("DEFAULT_SIGNUP_ROLE", "E_SOLUTIONS_USER");
  vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "false");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const prismaError = (code = "P2021") =>
  new Prisma.PrismaClientKnownRequestError(
    "The table `public.OAuthAccount` does not exist in the current database.",
    {
      code,
      clientVersion: "5.18.0",
      meta: { access_token: "never-print-meta" },
    },
  );
function database() {
  const user = {
    id: "test-user",
    email: profile.email,
    name: profile.name,
    username: "test.user",
    image: null,
    passwordHash: "never-print-hash",
    emailVerified: null,
    active: true,
    approvalPending: false,
    deletedAt: null,
    registrationMethod: "admin",
    sessionVersion: 0,
    roles: [{ role: { name: "E_SOLUTIONS_USER" } }],
  };
  const db = {
    $transaction: vi.fn(),
    oAuthAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([user]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue(user),
    },
    role: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "role", name: "E_SOLUTIONS_USER" }),
    },
    loginAttempt: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  db.$transaction.mockImplementation((action) => action(db));
  return { db, user, prisma: db as unknown as PrismaClient };
}

describe("Google diagnostic redaction", () => {
  it("retains the Prisma name, code and useful database message", () => {
    expect(safeGoogleError(prismaError())).toMatchObject({
      name: "PrismaClientKnownRequestError",
      code: "P2021",
      message:
        "The table `public.OAuthAccount` does not exist in the current database.",
    });
    expect(
      safeGoogleError({
        name: "PrismaClientInitializationError",
        message: "Database unreachable",
        errorCode: "P1001",
      }).code,
    ).toBe("P1001");
  });
  it("removes Prisma argument dumps but keeps the final explanation", () => {
    const result = safeGoogleError(
      new Error(
        'Invalid `prisma.user.create()` invocation:\n\n{ data: { passwordHash: "unfamiliar-secret", email: "person@example.test" } }\n\nArgument `username` is missing.',
      ),
    );
    expect(result.message).toBe("Argument `username` is missing.");
  });
  it("redacts configured secrets, URLs, OAuth values, authorization codes and hashes", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "private-client-secret");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://dbuser:db-password@private-host/db",
    );
    const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature";
    const hash = "$2b$12$" + "a".repeat(53);
    const message = `Database failed: private-client-secret https://host/callback?code=secret-code postgresql://other:other-pass@other-host/db password=plain-secret passwordHash=${hash} access_token=access-secret refresh_token='refresh-secret' id_token=${token} authorization code=auth-secret "unknown quoted secret"`;
    const result = safeGoogleError(new Error(message));
    for (const secret of [
      "private-client-secret",
      "https://host",
      "secret-code",
      "other-pass",
      "other-host",
      "plain-secret",
      hash,
      "access-secret",
      "refresh-secret",
      token,
      "auth-secret",
      "unknown quoted secret",
    ])
      expect(result.message).not.toContain(secret);
    expect(result.message).toContain("Database failed");
  });
  it("redacts OAuth credentials even when an exception does not label them", () => {
    const context = new GoogleDiagnostics(profile, {
      access_token: "opaque-access-value",
      refresh_token: "opaque-refresh-value",
      id_token: "opaque-id-value",
      code: "opaque-code-value",
    });
    context.failed(
      new Error(
        "Unexpected opaque-access-value opaque-refresh-value opaque-id-value opaque-code-value private@example.test",
      ),
    );
    const output = JSON.stringify(errorLog.mock.calls);
    expect(output).not.toMatch(/opaque-|private@example/);
    expect(output).toContain("Unexpected");
  });
  it("never serializes arbitrary error objects or metadata", () => {
    const result = safeGoogleError({
      access_token: "opaque-secret",
      meta: { password: "secret" },
      code: "oauth-authorization-code",
    });
    expect(result.code).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("opaque-secret");
    expect(() =>
      safeGoogleError({
        get message() {
          throw new Error("unreadable");
        },
      }),
    ).not.toThrow();
  });
});

describe("Google failure stages and unchanged outcomes", () => {
  it.each([
    ["oauthLookup", "OAUTH_ACCOUNT_LOOKUP", null, null],
    ["userLookup", "USER_LOOKUP", null, false],
    ["role", "ROLE_ASSIGNMENT", false, false],
    ["username", "USER_LOOKUP", false, false],
    ["newUser", "NEW_GOOGLE_USER_CREATE", false, false],
    ["oauthCreate", "OAUTH_ACCOUNT_CREATE", true, false],
    ["linkUpdate", "EXISTING_ACCOUNT_LINK", true, true],
    ["audit", "AUDIT_WRITE", true, true],
  ] as const)(
    "diagnoses %s and rethrows the same Prisma exception",
    async (failure, stage, userExists, oauthAccountExists) => {
      const { db, prisma } = database();
      const error = prismaError();
      if (["role", "username", "newUser"].includes(failure))
        db.user.findMany.mockResolvedValue([]);
      if (failure === "oauthLookup")
        db.oAuthAccount.findUnique.mockRejectedValue(error);
      if (failure === "userLookup") db.user.findMany.mockRejectedValue(error);
      if (failure === "role") db.role.findUnique.mockRejectedValue(error);
      if (failure === "username") db.user.findUnique.mockRejectedValue(error);
      if (failure === "newUser") db.user.create.mockRejectedValue(error);
      if (failure === "oauthCreate")
        db.oAuthAccount.create.mockRejectedValue(error);
      if (failure === "linkUpdate") db.user.update.mockRejectedValue(error);
      if (failure === "audit") db.auditLog.create.mockRejectedValue(error);
      await expect(signInGoogle(prisma, profile, profile.sub)).rejects.toBe(
        error,
      );
      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog).toHaveBeenCalledWith(
        "auth.google.failed",
        expect.objectContaining({
          provider: "google",
          stage,
          userExists,
          oauthAccountExists,
          emailPresent: true,
          emailVerified: true,
          userActive: userExists ? true : null,
          approvalPending: userExists ? false : null,
          code: "P2021",
          name: "PrismaClientKnownRequestError",
          requestId: expect.any(String),
        }),
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(
        /private@example|never-print/,
      );
    },
  );
  it("explains missing default role configuration without changing its public message", async () => {
    const { db, prisma } = database();
    db.user.findMany.mockResolvedValue([]);
    db.role.findUnique.mockResolvedValue(null);
    await expect(signInGoogle(prisma, profile, profile.sub)).rejects.toThrow(
      "Account registration is temporarily unavailable",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "auth.google.failed",
      expect.objectContaining({
        stage: "ROLE_ASSIGNMENT",
        applicationReason: "DEFAULT_SIGNUP_ROLE_NOT_FOUND",
      }),
    );
  });
  it("retains the existing retry limit and identifies each retry", async () => {
    const { db, prisma } = database();
    const error = prismaError("P2034");
    db.oAuthAccount.findUnique.mockRejectedValue(error);
    await expect(signInGoogle(prisma, profile, profile.sub)).rejects.toBe(
      error,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(5);
    expect(
      warnLog.mock.calls.filter(([event]) => event === "auth.google.retry"),
    ).toHaveLength(4);
    expect(errorLog).toHaveBeenCalledWith(
      "auth.google.failed",
      expect.objectContaining({ attempt: 5, code: "P2034" }),
    );
  });
  it("keeps unverified email and inactive-user denials unchanged", async () => {
    const { db, prisma, user } = database();
    expect(
      await signInGoogle(
        prisma,
        { ...profile, email_verified: false },
        profile.sub,
      ),
    ).toEqual({ status: "denied" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledWith(
      "auth.google.denied",
      expect.objectContaining({
        stage: "GOOGLE_EMAIL_VERIFICATION",
        emailVerified: false,
        reason: "GOOGLE_EMAIL_NOT_VERIFIED",
      }),
    );
    user.active = false;
    expect(await signInGoogle(prisma, profile, profile.sub)).toEqual({
      status: "denied",
    });
    expect(warnLog).toHaveBeenCalledWith(
      "auth.google.denied",
      expect.objectContaining({
        userExists: true,
        userActive: false,
        reason: "USER_INACTIVE",
      }),
    );
  });
  it("returns the same allowed result and never adds diagnostics to user data", async () => {
    const { prisma, user } = database();
    const result = await signInGoogle(prisma, profile, profile.sub);
    expect(result).toEqual({
      status: "allowed",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        image: null,
        sessionVersion: 0,
        roles: ["E_SOLUTIONS_USER"],
      },
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).toHaveBeenCalledWith(
      "auth.google.stage",
      expect.objectContaining({
        stage: "SESSION_CREATE",
        operation: "last_login_update",
      }),
    );
  });
  it("returns false from NextAuth with one detailed failure log and no raw browser error", async () => {
    callbackDb.$transaction.mockRejectedValue(prismaError());
    const result = await authOptions.callbacks!.signIn!({
      user: { id: profile.sub },
      profile,
      account: {
        provider: "google",
        type: "oauth",
        providerAccountId: profile.sub,
      },
    } as any);
    expect(result).toBe(false);
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "auth.google.failed",
      expect.objectContaining({ stage: "OAUTH_ACCOUNT_LOOKUP", code: "P2021" }),
    );
  });
  it("diagnoses a failure in the callback's denied-login audit", async () => {
    callbackDb.$transaction.mockResolvedValue({ status: "pending" });
    callbackDb.auditLog.create.mockRejectedValue(prismaError());
    expect(
      await authOptions.callbacks!.signIn!({
        user: { id: profile.sub },
        profile,
        account: {
          provider: "google",
          type: "oauth",
          providerAccountId: profile.sub,
        },
      } as any),
    ).toBe(false);
    expect(errorLog).toHaveBeenCalledWith(
      "auth.google.failed",
      expect.objectContaining({
        stage: "AUDIT_WRITE",
        operation: "LOGIN_FAILED",
      }),
    );
  });
  it("logs the JWT projection without adding diagnostic or OAuth fields to the token", async () => {
    const { user } = database();
    const token = await authOptions.callbacks!.jwt!({
      token: {},
      user: { ...user, roles: ["E_SOLUTIONS_USER"] },
      account: { provider: "google" },
    } as any);
    expect(token).toEqual({
      id: user.id,
      sessionVersion: 0,
      roles: ["E_SOLUTIONS_USER"],
      username: user.username,
      picture: null,
    });
    expect(infoLog).toHaveBeenCalledWith(
      "auth.google.stage",
      expect.objectContaining({
        stage: "SESSION_CREATE",
        operation: "jwt_callback",
        status: "completed",
      }),
    );
  });
});
