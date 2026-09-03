import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authorizeCredentials } from "./credentials";
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
      authorize: (credentials) => authorizeCredentials(prisma, credentials),
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
