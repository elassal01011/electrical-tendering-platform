import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { authorizeCredentials } from "../../src/lib/auth/credentials";
import {
  bootstrapAdmin,
  checkAdmin,
  resetAdmin,
} from "../../src/lib/auth/admin";
import {
  emailSchema,
  hashPassword,
  loginAttemptKey,
  newPasswordSchema,
  normalizeEmail,
} from "../../src/lib/auth/credentialPolicy";

const password = "Test-only-authentication-password";
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword(password);
});
function database() {
  const user = {
    id: "test-admin",
    email: "admin@example.test",
    name: "Test admin",
    passwordHash,
    active: true,
    deletedAt: null,
    sessionVersion: 3,
    roles: [{ role: { name: "SUPER_ADMIN" } }],
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ count: 1 }]),
    user: {
      findMany: vi.fn().mockResolvedValue([user]),
      update: vi.fn().mockResolvedValue(user),
      upsert: vi.fn().mockResolvedValue(user),
    },
    role: { upsert: vi.fn().mockResolvedValue({ id: "super-role" }) },
    userRole: {
      upsert: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({ userId: user.id }),
    },
    loginAttempt: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((action) => action(db));
  return { db, prisma: db as unknown as PrismaClient, user };
}
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("credential policy", () => {
  it("trims and lowercases email consistently, including the lockout key", () => {
    expect(normalizeEmail(" ADMIN@Example.Test ")).toBe("admin@example.test");
    expect(emailSchema.parse(" ADMIN@Example.Test ")).toBe(
      "admin@example.test",
    );
    expect(loginAttemptKey(" ADMIN@Example.Test ")).toBe(
      loginAttemptKey("admin@example.test"),
    );
  });
  it("enforces 12–72 UTF-8 bytes without truncating Unicode passwords", () => {
    for (const value of [
      "a".repeat(12),
      "a".repeat(72),
      "é".repeat(6),
      "é".repeat(36),
    ])
      expect(newPasswordSchema.safeParse(value).success).toBe(true);
    for (const value of ["a".repeat(11), "a".repeat(73), "é".repeat(37)])
      expect(newPasswordSchema.safeParse(value).success).toBe(false);
    expect(bcrypt.getRounds(passwordHash)).toBe(12);
  });
});

describe("NextAuth credentials", () => {
  it("accepts the compatible bcrypt password and clears prior attempts", async () => {
    const { db, prisma, user } = database();
    expect(
      await authorizeCredentials(prisma, {
        email: " ADMIN@Example.Test ",
        password,
      }),
    ).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      roles: ["SUPER_ADMIN"],
      sessionVersion: 3,
    });
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: user.email, mode: "insensitive" } },
      }),
    );
    expect(db.loginAttempt.deleteMany).toHaveBeenCalledWith({
      where: { key: loginAttemptKey(user.email) },
    });
    expect(log).not.toHaveBeenCalled();
  });
  it.each([
    "INVALID_PASSWORD",
    "USER_INACTIVE",
    "USER_NOT_FOUND",
    "RATE_LIMITED",
    "DATABASE_ERROR",
  ] as const)(
    "rejects %s with only safe structured server diagnostics",
    async (reason) => {
      const { db, prisma, user } = database();
      if (reason === "USER_INACTIVE") user.active = false;
      if (reason === "USER_NOT_FOUND") db.user.findMany.mockResolvedValue([]);
      if (reason === "RATE_LIMITED")
        db.$queryRaw.mockResolvedValue([{ count: 9 }]);
      if (reason === "DATABASE_ERROR")
        db.$queryRaw.mockRejectedValue(
          new Error("postgresql://secret:password@private-host"),
        );
      expect(
        await authorizeCredentials(prisma, {
          email: user.email,
          password: reason === "INVALID_PASSWORD" ? "wrong" : password,
        }),
      ).toBeNull();
      expect(log).toHaveBeenCalledWith("auth.credentials", {
        reason,
        emailHash: loginAttemptKey(user.email),
        requestId: expect.any(String),
      });
      const output = JSON.stringify(log.mock.calls);
      expect(output).not.toContain(user.email);
      expect(output).not.toContain(passwordHash);
      expect(output).not.toContain("private-host");
      expect(db.loginAttempt.deleteMany).not.toHaveBeenCalled();
      if (reason === "RATE_LIMITED")
        expect(db.user.findMany).not.toHaveBeenCalled();
    },
  );
  it("rejects a soft-deleted account", async () => {
    const { db, prisma, user } = database();
    db.user.findMany.mockResolvedValue([{ ...user, deletedAt: new Date() }]);
    expect(
      await authorizeCredentials(prisma, { email: user.email, password }),
    ).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "auth.credentials",
      expect.objectContaining({ reason: "USER_INACTIVE" }),
    );
  });
  it("fails closed on legacy duplicate email casing", async () => {
    const { db, prisma, user } = database();
    db.user.findMany.mockResolvedValue([user, { ...user, id: "duplicate" }]);
    expect(
      await authorizeCredentials(prisma, { email: user.email, password }),
    ).toBeNull();
  });
  it("rejects bcrypt truncation and absent credentials without database access", async () => {
    const { db, prisma, user } = database();
    expect(
      await authorizeCredentials(prisma, {
        email: user.email,
        password: "é".repeat(37),
      }),
    ).toBeNull();
    expect(await authorizeCredentials(prisma, undefined)).toBeNull();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("admin recovery", () => {
  const env = { ADMIN_EMAIL: " ADMIN@Example.Test ", ADMIN_PASSWORD: password };
  it.each([{}, { ADMIN_EMAIL: env.ADMIN_EMAIL }, { ADMIN_PASSWORD: password }])(
    "does not create a default account when bootstrap credentials are missing: %j",
    async (missing) => {
      const { db, prisma } = database();
      expect(await bootstrapAdmin(prisma, missing)).toBeNull();
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it("normal seed preserves an existing password and ensures active SUPER_ADMIN access", async () => {
    const { db, prisma, user } = database();
    user.active = false;
    await bootstrapAdmin(prisma, env);
    const update = db.user.update.mock.calls[0][0].data;
    expect(update).toMatchObject({
      email: user.email,
      active: true,
      deletedAt: null,
      sessionVersion: { increment: 1 },
    });
    expect(update).not.toHaveProperty("passwordHash");
    expect(db.user.upsert).not.toHaveBeenCalled();
    expect(db.role.upsert.mock.calls[0][0].where.name).toBe("SUPER_ADMIN");
    expect(db.userRole.upsert).toHaveBeenCalledWith({
      where: { userId_roleId: { userId: user.id, roleId: "super-role" } },
      update: {},
      create: { userId: user.id, roleId: "super-role" },
    });
  });
  it("bootstraps a normalized account with a compatible cost-12 password", async () => {
    const { db, prisma } = database();
    db.user.findMany.mockResolvedValue([]);
    await bootstrapAdmin(prisma, env);
    const creation = db.user.upsert.mock.calls[0][0].create;
    expect(creation.email).toBe("admin@example.test");
    expect(bcrypt.getRounds(creation.passwordHash)).toBe(12);
    expect(await bcrypt.compare(password, creation.passwordHash)).toBe(true);
    expect(db.user.upsert.mock.calls[0][0].update).not.toHaveProperty(
      "passwordHash",
    );
  });
  it("explicit reset clears normalized lockout and increments sessionVersion atomically", async () => {
    const { db, prisma, user } = database();
    await resetAdmin(prisma, env);
    expect(db.$transaction).toHaveBeenCalledOnce();
    const update = db.user.update.mock.calls[0][0].data;
    expect(update).toMatchObject({
      active: true,
      deletedAt: null,
      sessionVersion: { increment: 1 },
    });
    expect(await bcrypt.compare(password, update.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(update.passwordHash)).toBe(12);
    expect(db.loginAttempt.deleteMany).toHaveBeenCalledWith({
      where: { key: loginAttemptKey(user.email) },
    });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(
      update.passwordHash,
    );
  });
  it("reset refuses a missing account without creating one", async () => {
    const { db, prisma } = database();
    db.user.findMany.mockResolvedValue([]);
    await expect(resetAdmin(prisma, env)).rejects.toThrow("not found");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("invalid or missing reset credentials fail before database access", async () => {
    const { db, prisma } = database();
    for (const input of [
      {},
      { ADMIN_EMAIL: env.ADMIN_EMAIL },
      { ...env, ADMIN_PASSWORD: "short" },
    ])
      await expect(resetAdmin(prisma, input)).rejects.toThrow("Set ADMIN_");
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it("check returns only existence, effective active status, role and lockout", async () => {
    const { db, prisma } = database();
    db.$queryRaw.mockResolvedValue([{ locked: true }]);
    expect(await checkAdmin(prisma, env)).toEqual({
      exists: true,
      active: true,
      superAdmin: true,
      locked: true,
    });
    db.user.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([{ locked: false }]);
    expect(await checkAdmin(prisma, env)).toEqual({
      exists: false,
      active: false,
      superAdmin: false,
      locked: false,
    });
  });
});
