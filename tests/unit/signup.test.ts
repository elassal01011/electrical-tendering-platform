import { describe, expect, it, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  signupSchema,
  usernameSchema,
  safeAuthRedirect,
} from "../../src/lib/auth/signupPolicy";
import { signupSettings } from "../../src/lib/auth/registration";
import { finishSignup } from "../../src/lib/client/signup";
import { hasPermission } from "../../src/lib/auth/permissions";
import { signInGoogle, googleImage } from "../../src/lib/auth/google";
import {
  requireSameOrigin,
  registrationResponse,
} from "../../src/lib/auth/http";
const valid = {
  name: "Test Engineer",
  username: " Test.User_1 ",
  email: " TEST@Example.Test ",
  password: "Twelve-characters!",
  confirmPassword: "Twelve-characters!",
};
afterEach(() => vi.unstubAllEnvs());
describe("signup validation", () => {
  it("normalizes both email and username", () => {
    expect(signupSchema.parse(valid)).toMatchObject({
      username: "test.user_1",
      email: "test@example.test",
    });
  });
  it.each([
    "ab",
    "a".repeat(31),
    "name with space",
    "user@name",
    "bad/name",
    "user-name",
  ])("rejects invalid username %s", (username) => {
    expect(usernameSchema.safeParse(username).success).toBe(false);
  });
  it.each(["short", "a".repeat(11), "é".repeat(37), "a".repeat(73)])(
    "rejects weak or oversized passwords",
    (password) => {
      expect(
        signupSchema.safeParse({
          ...valid,
          password,
          confirmPassword: password,
        }).success,
      ).toBe(false);
    },
  );
  it("rejects password mismatch and invalid name/email", () => {
    for (const input of [
      { confirmPassword: "different" },
      { name: "x" },
      { email: "invalid" },
    ])
      expect(signupSchema.safeParse({ ...valid, ...input }).success).toBe(
        false,
      );
  });
});
describe("signup access policy", () => {
  it("defaults to E_SOLUTIONS_USER and never creates a role from user input", async () => {
    vi.stubEnv("DEFAULT_SIGNUP_ROLE", "");
    vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "false");
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: "role", name: "E_SOLUTIONS_USER" });
    const result = await signupSettings({
      role: { findUnique },
    } as unknown as PrismaClient);
    expect(findUnique).toHaveBeenCalledWith({
      where: { name: "E_SOLUTIONS_USER" },
    });
    expect(result.approval).toBe(false);
  });
  it("allows explicitly configured SUPER_ADMIN only when its role exists", async () => {
    vi.stubEnv("DEFAULT_SIGNUP_ROLE", "SUPER_ADMIN");
    vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "true");
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: "role", name: "SUPER_ADMIN" });
    const db = { role: { findUnique } } as unknown as PrismaClient;
    expect((await signupSettings(db)).approval).toBe(true);
    findUnique.mockResolvedValue(null);
    await expect(signupSettings(db)).rejects.toThrow("temporarily unavailable");
    vi.stubEnv("DEFAULT_SIGNUP_ROLE", "TYPO_ADMIN");
    await expect(signupSettings(db)).rejects.toThrow("temporarily unavailable");
  });
  it.each([
    "project.view",
    "project.create",
    "boq.import",
    "boq.edit",
    "catalog.edit",
    "supplier.edit",
    "pricing.edit",
    "quote.create",
    "document.upload",
    "report.view",
  ])("standard users can work with %s", (permission) => {
    expect(hasPermission(["E_SOLUTIONS_USER"], permission)).toBe(true);
  });
  it.each([
    "user.manage",
    "settings.edit",
    "audit.view",
    "quote.approve",
    "security.edit",
    "role.edit",
  ])("standard users cannot perform %s", (permission) => {
    expect(hasPermission(["E_SOLUTIONS_USER"], permission)).toBe(false);
    expect(hasPermission(["SUPER_ADMIN"], permission)).toBe(true);
  });
});
describe("signup completion", () => {
  it("automatically signs in and navigates to dashboard", async () => {
    const signIn = vi.fn().mockResolvedValue({ ok: true });
    expect(
      await finishSignup(
        { pendingApproval: false },
        "user",
        valid.password,
        signIn,
      ),
    ).toBe("/dashboard");
    expect(signIn).toHaveBeenCalledWith("credentials", {
      redirect: false,
      identifier: "user",
      password: valid.password,
    });
  });
  it("shows registration success at login when automatic login fails", async () => {
    for (const signIn of [
      vi.fn().mockResolvedValue({ ok: false }),
      vi.fn().mockRejectedValue(new Error("network")),
    ])
      expect(
        await finishSignup(
          { pendingApproval: false },
          "user",
          valid.password,
          signIn,
        ),
      ).toBe("/login?registered=1");
  });
  it("does not attempt login for a pending user", async () => {
    const signIn = vi.fn();
    expect(
      await finishSignup(
        { pendingApproval: true },
        "user",
        valid.password,
        signIn,
      ),
    ).toBe("/login?pending=1");
    expect(signIn).not.toHaveBeenCalled();
  });
});
describe("OAuth and request boundaries", () => {
  it.each([
    "https://evil.example/x",
    "//evil.example/x",
    "/\\evil.example",
    "javascript:alert(1)",
  ])("blocks external redirects: %s", (url) => {
    expect(safeAuthRedirect(url, "https://app.example")).toBe(
      "https://app.example/dashboard",
    );
  });
  it("preserves same-origin callback paths", () => {
    expect(safeAuthRedirect("/account", "https://app.example")).toBe(
      "https://app.example/account",
    );
  });
  it("rejects unverified Google email and mismatched provider subject before DB access", async () => {
    const transaction = vi.fn();
    const db = { $transaction: transaction } as unknown as PrismaClient;
    expect(
      await signInGoogle(
        db,
        { sub: "one", email: "u@example.test", email_verified: false },
        "one",
      ),
    ).toEqual({ status: "denied" });
    expect(
      await signInGoogle(
        db,
        { sub: "one", email: "u@example.test", email_verified: true },
        "two",
      ),
    ).toEqual({ status: "denied" });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("accepts Google-hosted HTTPS images only", () => {
    expect(googleImage("https://lh3.googleusercontent.com/avatar")).toContain(
      "googleusercontent.com",
    );
    expect(googleImage("https://evil.example/avatar")).toBeNull();
    expect(googleImage("javascript:alert(1)")).toBeNull();
  });
  it("rejects cross-origin form mutations", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example/api/auth/signup", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow("could not be verified");
  });
  it("never returns database credentials or raw exceptions", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = registrationResponse(
        new Error("postgresql://secret@private-host"),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/secret|private-host/);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private-host/);
    } finally {
      log.mockRestore();
    }
  });
});
