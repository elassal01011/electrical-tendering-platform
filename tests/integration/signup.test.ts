import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
const sessionState = vi.hoisted(() => ({ session: null as any }));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionState.session),
}));
import { prisma } from "../../src/lib/db/prisma";
import { registerCredentials } from "../../src/lib/auth/registration";
import { signInGoogle } from "../../src/lib/auth/google";
import { authorizeCredentials } from "../../src/lib/auth/credentials";
import { authOptions } from "../../src/lib/auth/authOptions";
import {
  getAccount,
  changeAccountPassword,
  updateProfile,
} from "../../src/lib/auth/account";
import {
  loginAttemptKey,
  hashPassword,
} from "../../src/lib/auth/credentialPolicy";
import { allowSignup } from "../../src/lib/auth/rateLimit";
import { bootstrapAdmin } from "../../src/lib/auth/admin";
import * as signupApi from "../../src/app/api/auth/signup/route";
import * as accountApi from "../../src/app/api/account/route";
import * as usersApi from "../../src/app/api/users/route";

const enabled =
  process.env.VERIFY_DATABASE === "true" &&
  process.env.DATABASE_URL?.includes("127.0.0.1:55439/esolutions_verification");
describe.skipIf(!enabled)(
  "signup and Google authentication on disposable PostgreSQL",
  () => {
    const nonce = Date.now().toString();
    const password = "Disposable-signup-password";
    let sequence = 0,
      adminId: string;
    let log: ReturnType<typeof vi.spyOn>;
    const input = () => {
      const key = `s${nonce}${sequence++}`;
      return {
        name: "Test Engineer",
        username: key,
        email: `${key}@example.test`,
        password,
        confirmPassword: password,
      };
    };
    const google = (email: string, sub = `google-${nonce}-${sequence++}`) => ({
      email,
      sub,
      name: "Google Engineer",
      email_verified: true,
      picture: "https://lh3.googleusercontent.com/test-avatar",
    });
    const request = (url: string, data: unknown, method = "POST") =>
      new NextRequest(`http://localhost${url}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify(data),
      });
    beforeAll(async () => {
      vi.stubEnv("DEFAULT_SIGNUP_ROLE", "E_SOLUTIONS_USER");
      vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "false");
      log = vi.spyOn(console, "warn").mockImplementation(() => {});
      adminId = (await bootstrapAdmin(prisma, {
        ADMIN_EMAIL: `admin-${nonce}@example.test`,
        ADMIN_PASSWORD: password,
      }))!.id;
    });
    afterEach(() => {
      sessionState.session = null;
      vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "false");
    });
    afterAll(async () => {
      log.mockRestore();
      vi.unstubAllEnvs();
      await prisma.$disconnect();
    });

    it("creates a normalized credentials account with the default role and cost-12 hash", async () => {
      const form = input();
      const created = await registerCredentials(prisma, {
        ...form,
        email: ` ${form.email.toUpperCase()} `,
        username: ` ${form.username.toUpperCase()} `,
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        include: { roles: { include: { role: true } } },
      });
      expect(user.email).toBe(form.email);
      expect(user.username).toBe(form.username);
      expect(user.active).toBe(true);
      expect(user.roles.map((r) => r.role.name)).toEqual(["E_SOLUTIONS_USER"]);
      expect(bcrypt.getRounds(user.passwordHash!)).toBe(12);
      expect(await bcrypt.compare(password, user.passwordHash!)).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { action: "USER_SIGNUP", entityId: user.id },
        }),
      ).toBe(1);
      expect(
        (
          await authorizeCredentials(prisma, {
            identifier: form.email.toUpperCase(),
            password,
          })
        )?.id,
      ).toBe(user.id);
      expect(
        (
          await authorizeCredentials(prisma, {
            identifier: form.username.toUpperCase(),
            password,
          })
        )?.id,
      ).toBe(user.id);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .lastLoginAt,
      ).not.toBeNull();
    });

    it("returns friendly duplicate email and username errors, including concurrent signups", async () => {
      const form = input();
      await registerCredentials(prisma, form);
      await expect(
        registerCredentials(prisma, {
          ...input(),
          email: form.email.toUpperCase(),
        }),
      ).rejects.toThrow("email already exists");
      await expect(
        registerCredentials(prisma, {
          ...input(),
          username: form.username.toUpperCase(),
        }),
      ).rejects.toThrow("username is already taken");
      const concurrent = input();
      const results = await Promise.allSettled([
        registerCredentials(prisma, concurrent),
        registerCredentials(prisma, concurrent),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await prisma.user.count({ where: { email: concurrent.email } }),
      ).toBe(1);
    });

    it("shares the existing eight-attempt lockout across email and username aliases", async () => {
      const form = input();
      await registerCredentials(prisma, form);
      for (let i = 0; i < 8; i++)
        expect(
          await authorizeCredentials(prisma, {
            identifier: i % 2 ? form.email : form.username,
            password: "wrong",
          }),
        ).toBeNull();
      expect(
        await authorizeCredentials(prisma, {
          identifier: form.email,
          password,
        }),
      ).toBeNull();
      expect(
        await authorizeCredentials(prisma, {
          identifier: form.username,
          password,
        }),
      ).toBeNull();
      const key = loginAttemptKey(form.email);
      expect(await prisma.loginAttempt.count({ where: { key } })).toBe(1);
      await prisma.loginAttempt.update({
        where: { key },
        data: { expiresAt: new Date(0) },
      });
      expect(
        (
          await authorizeCredentials(prisma, {
            identifier: form.username,
            password,
          })
        )?.email,
      ).toBe(form.email);
      expect(await prisma.loginAttempt.count({ where: { key } })).toBe(0);
    }, 20000);

    it("creates pending users and blocks sign-in until an administrator activates them", async () => {
      vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "true");
      const form = input();
      const created = await registerCredentials(prisma, form);
      expect(created.pendingApproval).toBe(true);
      expect(
        await authorizeCredentials(prisma, {
          identifier: form.email,
          password,
        }),
      ).toBeNull();
      sessionState.session = {
        user: { id: adminId, roles: ["SUPER_ADMIN"], sessionVersion: 0 },
      };
      const response = await usersApi.PATCH(
        request("/api/users", { id: created.id, active: true }, "PATCH"),
      );
      expect(response.status).toBe(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: created.id } }))
          .approvalPending,
      ).toBe(false);
      expect(
        (
          await authorizeCredentials(prisma, {
            identifier: form.username,
            password,
          })
        )?.id,
      ).toBe(created.id);
      expect(
        await prisma.auditLog.count({
          where: { entityId: created.id, action: "USER_ACTIVATED" },
        }),
      ).toBe(1);
    });

    it("creates one Google user/link with a generated collision-free username", async () => {
      const base = `g${nonce}`;
      const first = google(`${base}@example.test`),
        second = google(`${base}@another.test`);
      const result = await signInGoogle(prisma, first, first.sub);
      const other = await signInGoogle(prisma, second, second.sub);
      expect(result.status).toBe("allowed");
      expect(other.status).toBe("allowed");
      if (result.status !== "allowed" || other.status !== "allowed")
        throw new Error("Google creation failed");
      expect(result.user.username).toBe(base);
      expect(other.user.username).toBe(`${base}2`);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: result.user.id },
      });
      expect(stored.passwordHash).toBeNull();
      expect(stored.emailVerified).not.toBeNull();
      expect(stored.image).toBe(first.picture);
      expect(result.user.roles).toEqual(["E_SOLUTIONS_USER"]);
      expect((await signInGoogle(prisma, first, first.sub)).status).toBe(
        "allowed",
      );
      expect(await prisma.user.count({ where: { email: first.email } })).toBe(
        1,
      );
      expect(
        await prisma.oAuthAccount.count({ where: { userId: stored.id } }),
      ).toBe(1);
      expect(
        await authorizeCredentials(prisma, {
          identifier: first.email,
          password,
        }),
      ).toBeNull();
    });

    it("links verified Google email to an existing trusted account without replacing it", async () => {
      const form = input();
      const existing = await prisma.user.create({
        data: {
          name: form.name,
          email: form.email,
          passwordHash: await hashPassword(password),
        },
      });
      const profile = google(` ${form.email.toUpperCase()} `);
      const result = await signInGoogle(prisma, profile, profile.sub);
      expect(result.status).toBe("allowed");
      if (result.status !== "allowed") throw new Error("Link failed");
      expect(result.user.id).toBe(existing.id);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: existing.id } }))
          .passwordHash,
      ).toBe(existing.passwordHash);
      expect(await prisma.user.count({ where: { email: form.email } })).toBe(1);
    });

    it("revokes an unverified public signup's password and sessions on first verified Google linking", async () => {
      const form = input();
      const created = await registerCredentials(prisma, form);
      const profile = google(form.email);
      expect((await signInGoogle(prisma, profile, profile.sub)).status).toBe(
        "allowed",
      );
      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(updated.passwordHash).toBeNull();
      expect(updated.sessionVersion).toBe(1);
      expect(
        await authorizeCredentials(prisma, {
          identifier: form.email,
          password,
        }),
      ).toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { action: "GOOGLE_ACCOUNT_LINKED", entityId: created.id },
        }),
      ).toBe(1);
    });

    it("never links unverified profiles, transfers an existing link, or reactivates a disabled user", async () => {
      const profile = google(input().email);
      const result = await signInGoogle(prisma, profile, profile.sub);
      if (result.status !== "allowed") throw new Error("Setup failed");
      const unverified = { ...profile, email_verified: false };
      expect((await signInGoogle(prisma, unverified, profile.sub)).status).toBe(
        "denied",
      );
      expect(
        (
          await signInGoogle(
            prisma,
            { ...profile, sub: "different-subject" },
            "different-subject",
          )
        ).status,
      ).toBe("denied");
      await prisma.user.update({
        where: { id: result.user.id },
        data: { active: false },
      });
      expect((await signInGoogle(prisma, profile, profile.sub)).status).toBe(
        "denied",
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } }))
          .active,
      ).toBe(false);
    });

    it("keeps Google registrations pending when approval is required", async () => {
      vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "true");
      const profile = google(input().email);
      expect((await signInGoogle(prisma, profile, profile.sub)).status).toBe(
        "pending",
      );
      expect((await signInGoogle(prisma, profile, profile.sub)).status).toBe(
        "pending",
      );
      expect(
        await prisma.oAuthAccount.count({
          where: { providerAccountId: profile.sub },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { email: profile.email },
          })
        ).approvalPending,
      ).toBe(true);
    });

    it("sets a first Google-only password, requires it for subsequent changes and revokes sessions", async () => {
      const profile = google(input().email);
      const result = await signInGoogle(prisma, profile, profile.sub);
      if (result.status !== "allowed") throw new Error("Setup failed");
      await changeAccountPassword(prisma, result.user.id, 0, {
        newPassword: password,
      });
      expect((await getAccount(prisma, result.user.id)).authMethod).toBe(
        "Google + password",
      );
      expect(
        (
          await authorizeCredentials(prisma, {
            identifier: profile.email,
            password,
          })
        )?.sessionVersion,
      ).toBe(1);
      await expect(
        changeAccountPassword(prisma, result.user.id, 1, {
          newPassword: "Different-new-password",
        }),
      ).rejects.toThrow("Current password");
      await expect(
        changeAccountPassword(prisma, result.user.id, 0, {
          currentPassword: password,
          newPassword: "Different-new-password",
        }),
      ).rejects.toThrow("session expired");
      await changeAccountPassword(prisma, result.user.id, 1, {
        currentPassword: password,
        newPassword: "Different-new-password",
      });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } }))
          .sessionVersion,
      ).toBe(2);
      expect(
        await prisma.auditLog.count({
          where: { action: "PASSWORD_CHANGED", entityId: result.user.id },
        }),
      ).toBe(2);
    });

    it("updates username with uniqueness checks and a secret-free audit record", async () => {
      const form = input(),
        other = input();
      const created = await registerCredentials(prisma, form);
      await registerCredentials(prisma, other);
      await updateProfile(prisma, created.id, {
        name: "Updated Engineer",
        username: ` NEW${nonce} `,
      });
      expect((await getAccount(prisma, created.id)).username).toBe(
        `new${nonce}`,
      );
      await expect(
        updateProfile(prisma, created.id, {
          name: form.name,
          username: other.username,
        }),
      ).rejects.toThrow("username is already taken");
      expect(
        await prisma.auditLog.count({
          where: { action: "USERNAME_CHANGED", entityId: created.id },
        }),
      ).toBe(1);
      expect(
        JSON.stringify(await getAccount(prisma, created.id)),
      ).not.toContain("passwordHash");
    });

    it("enforces expiring signup email and IP limits", async () => {
      const email = input().email;
      for (let i = 0; i < 5; i++)
        expect(await allowSignup(prisma, email, `test-ip-${i}`)).toBe(true);
      expect(await allowSignup(prisma, email, "another-ip")).toBe(false);
      await prisma.loginAttempt.update({
        where: { key: loginAttemptKey(`signup:email:${email}`) },
        data: { expiresAt: new Date(0) },
      });
      expect(await allowSignup(prisma, email, "yet-another-ip")).toBe(true);
      const ip = `one-ip-${nonce}`;
      for (let i = 0; i < 10; i++)
        expect(await allowSignup(prisma, input().email, ip)).toBe(true);
      expect(await allowSignup(prisma, input().email, ip)).toBe(false);
    });

    it("protects APIs with current roles, hides hashes and revokes stale sessions", async () => {
      const form = input();
      const created = await registerCredentials(prisma, form);
      expect((await accountApi.GET()).status).toBe(401);
      expect((await usersApi.GET()).status).toBe(401);
      // Forged/stale token roles cannot elevate permissions: the guard reloads DB roles.
      sessionState.session = {
        user: { id: created.id, roles: ["SUPER_ADMIN"], sessionVersion: 0 },
      };
      expect((await usersApi.GET()).status).toBe(403);
      const self = await accountApi.GET();
      expect(self.status).toBe(200);
      expect(await self.text()).not.toContain("passwordHash");
      sessionState.session = {
        user: { id: adminId, roles: ["SUPER_ADMIN"], sessionVersion: 0 },
      };
      const users = await usersApi.GET();
      expect(users.status).toBe(200);
      expect(await users.text()).not.toContain("passwordHash");
      expect(
        (
          await usersApi.PATCH(
            request(
              "/api/users",
              { id: created.id, revokeSessions: true },
              "PATCH",
            ),
          )
        ).status,
      ).toBe(200);
      sessionState.session = {
        user: {
          id: created.id,
          roles: ["E_SOLUTIONS_USER"],
          sessionVersion: 0,
        },
      };
      expect((await accountApi.GET()).status).toBe(401);
    });

    it("returns safe signup API responses and field validation errors", async () => {
      const form = input();
      const response = await signupApi.POST(request("/api/auth/signup", form));
      expect(response.status).toBe(201);
      expect(await response.text()).not.toMatch(
        /passwordHash|Disposable-signup-password/,
      );
      expect(
        (await signupApi.POST(request("/api/auth/signup", form))).status,
      ).toBe(409);
      expect(
        (
          await signupApi.POST(
            request("/api/auth/signup", {
              ...input(),
              username: "bad username",
            }),
          )
        ).status,
      ).toBe(400);
      const badOrigin = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: JSON.stringify(form),
      });
      expect((await signupApi.POST(badOrigin)).status).toBe(403);
    });

    it("maps the Google callback into the existing JWT session architecture", async () => {
      const profile = google(input().email);
      const user: any = { id: profile.sub, email: profile.email };
      const callbacks = authOptions.callbacks!;
      expect(
        await callbacks.signIn!({
          user,
          account: {
            provider: "google",
            providerAccountId: profile.sub,
            type: "oauth",
          },
          profile,
        } as any),
      ).toBe(true);
      expect(user.id).not.toBe(profile.sub);
      const token = await callbacks.jwt!({ token: {}, user } as any);
      const session = await callbacks.session!({
        session: { user: {} },
        token,
      } as any);
      expect(session.user).toMatchObject({
        id: user.id,
        roles: ["E_SOLUTIONS_USER"],
        sessionVersion: 0,
        username: user.username,
      });
    });
  },
);
