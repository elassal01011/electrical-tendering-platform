import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  bootstrapAdmin,
  checkAdmin,
  resetAdmin,
} from "../../src/lib/auth/admin";
import { authorizeCredentials } from "../../src/lib/auth/credentials";
import { loginAttemptKey } from "../../src/lib/auth/credentialPolicy";

const enabled =
  process.env.VERIFY_DATABASE === "true" &&
  process.env.DATABASE_URL?.includes(
    "127.0.0.1:55439/esolutions_verification",
  ) &&
  process.env.DIRECT_URL === process.env.DATABASE_URL;

describe.skipIf(!enabled)(
  "admin authentication against disposable PostgreSQL",
  () => {
    const prisma = new PrismaClient();
    afterAll(() => prisma.$disconnect());
    it("preserves seed passwords, expires lockout, resets access, and uses DIRECT_URL in CLIs", async () => {
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const email = `auth-recovery-${Date.now()}@example.test`;
        const env = {
          ADMIN_EMAIL: ` ${email.toUpperCase()} `,
          ADMIN_PASSWORD: "Disposable-first-password",
        };
        expect(await bootstrapAdmin(prisma, {})).toBeNull();
        const admin = await bootstrapAdmin(prisma, env);
        const first = await prisma.user.findUniqueOrThrow({
          where: { id: admin!.id },
        });
        await bootstrapAdmin(prisma, {
          ...env,
          ADMIN_PASSWORD: "Seed-must-not-replace-this",
        });
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: first.id } }))
            .passwordHash,
        ).toBe(first.passwordHash);
        expect(
          await prisma.userRole.count({
            where: { userId: first.id, role: { name: "SUPER_ADMIN" } },
          }),
        ).toBe(1);
        const credentials = {
          email: env.ADMIN_EMAIL,
          password: env.ADMIN_PASSWORD,
        };
        for (let i = 0; i < 8; i++)
          expect(
            await authorizeCredentials(prisma, {
              ...credentials,
              password: "wrong",
            }),
          ).toBeNull();
        expect((await checkAdmin(prisma, env)).locked).toBe(true);
        const key = loginAttemptKey(email);
        const attempt = await prisma.loginAttempt.findUniqueOrThrow({
          where: { key },
        });
        expect(await authorizeCredentials(prisma, credentials)).toBeNull();
        expect(
          (await prisma.loginAttempt.findUniqueOrThrow({ where: { key } }))
            .expiresAt,
        ).toEqual(attempt.expiresAt);
        await prisma.loginAttempt.update({
          where: { key },
          data: { expiresAt: new Date(0) },
        });
        expect((await checkAdmin(prisma, env)).locked).toBe(false);
        expect((await authorizeCredentials(prisma, credentials))?.id).toBe(
          first.id,
        );
        expect(await prisma.loginAttempt.count({ where: { key } })).toBe(0);

        await prisma.loginAttempt.create({
          data: { key, count: 50, expiresAt: new Date(Date.now() + 900000) },
        });
        await prisma.user.update({
          where: { id: first.id },
          data: { active: false, deletedAt: new Date() },
        });
        const resetEnv = {
          ...env,
          ADMIN_PASSWORD: "Disposable-reset-password",
        };
        await resetAdmin(prisma, resetEnv);
        const reset = await prisma.user.findUniqueOrThrow({
          where: { id: first.id },
        });
        expect(reset.sessionVersion).toBe(first.sessionVersion + 1);
        expect(reset.active).toBe(true);
        expect(reset.deletedAt).toBeNull();
        expect(await prisma.loginAttempt.count({ where: { key } })).toBe(0);
        expect(await authorizeCredentials(prisma, credentials)).toBeNull();
        expect(
          (
            await authorizeCredentials(prisma, {
              email,
              password: resetEnv.ADMIN_PASSWORD,
            })
          )?.sessionVersion,
        ).toBe(reset.sessionVersion);

        // A deliberately unusable runtime URL proves that administrative CLIs use
        // DIRECT_URL explicitly. These processes only receive disposable test secrets.
        const childEnv = {
          ...process.env,
          ...resetEnv,
          DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
          SEED_DEMO_DATA: "false",
        };
        const run = (script: string) =>
          execFileSync(process.execPath, ["--import", "tsx", script], {
            env: childEnv,
            encoding: "utf8",
            timeout: 30000,
          });
        const status = run("scripts/check-admin.ts");
        expect(status.trim().split(/\r?\n/)).toEqual([
          "Admin user exists: yes",
          "Active: yes",
          "Role: SUPER_ADMIN",
          "Currently locked out: no",
        ]);
        const seedOutput = run("prisma/seed.ts");
        expect(seedOutput).toContain("Existing password preserved");
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: first.id } }))
            .passwordHash,
        ).toBe(reset.passwordHash);
        await prisma.loginAttempt.create({
          data: { key, count: 8, expiresAt: new Date(Date.now() + 900000) },
        });
        const resetOutput = run("scripts/reset-admin.ts");
        expect(resetOutput).toContain("login lockout cleared");
        expect(await prisma.loginAttempt.count({ where: { key } })).toBe(0);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: first.id } }))
            .sessionVersion,
        ).toBe(reset.sessionVersion + 1);
        for (const output of [status, seedOutput, resetOutput]) {
          expect(output).not.toContain(email);
          expect(output).not.toContain(resetEnv.ADMIN_PASSWORD);
          expect(output).not.toContain(reset.passwordHash);
          expect(output).not.toContain("postgresql://");
        }
      } finally {
        log.mockRestore();
      }
    }, 60000);
  },
);
