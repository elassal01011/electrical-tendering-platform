import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials?.password ||
          Buffer.byteLength(credentials.password, "utf8") > 72
        )
          return null;
        const email = credentials.email.trim().toLowerCase();
        const key = createHash("sha256").update(email).digest("hex");
        const attempts = await prisma.$queryRaw<
          { count: number }[]
        >`INSERT INTO "LoginAttempt" ("key", "count", "expiresAt") VALUES (${key}, 1, NOW() + INTERVAL '15 minutes') ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "LoginAttempt"."expiresAt" < NOW() THEN 1 ELSE "LoginAttempt"."count" + 1 END, "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" < NOW() THEN NOW() + INTERVAL '15 minutes' ELSE "LoginAttempt"."expiresAt" END RETURNING "count"`;
        if (attempts[0].count > 8) return null;

        const accounts = await prisma.user.findMany({
          where: { email: { equals: email, mode: "insensitive" } },
          include: { roles: { include: { role: true } } },
          take: 2,
        });
        const user = accounts.length === 1 ? accounts[0] : null;
        if (!user || !user.active || user.deletedAt) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) return null;
        await prisma.loginAttempt.deleteMany({ where: { key } });

        return {
          id: user.id,
          sessionVersion: user.sessionVersion,
          email: user.email,
          name: user.name,
          roles: user.roles.map((r) => r.role.name),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
        token.roles = user.roles;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.sessionVersion = token.sessionVersion;
        session.user.roles = token.roles;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  logger: {
    error(code) {
      console.error("auth.error", { code });
    },
    warn(code) {
      console.warn("auth.warning", { code });
    },
    debug() {},
  },
};

/** Simple permission check helper used by API routes. Extend the map as
 * more permission keys are needed — see Prisma Permission model for the
 * full architecture this is designed to grow into. */
export { hasPermission, ROLE_PERMISSIONS } from "./permissions";
