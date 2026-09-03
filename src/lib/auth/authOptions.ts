import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import {
  GoogleDiagnostics,
  googleDiagnosticContexts,
} from "./googleDiagnostics";
import { signInGoogle } from "./google";
import { safeAuthRedirect } from "./signupPolicy";
import { authorizeCredentials } from "./credentials";
import { prisma } from "@/lib/db/prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials) => authorizeCredentials(prisma, credentials),
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                scope: "openid email profile",
                prompt: "select_account",
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google")
        return account?.provider === "credentials";
      const diagnostics = new GoogleDiagnostics(profile, account);
      try {
        const result = await signInGoogle(
          prisma,
          profile,
          account.providerAccountId,
          diagnostics,
        );
        if (result.status === "allowed") {
          diagnostics.start("SESSION_CREATE", "sign_in_user_projection");
          Object.assign(user, result.user);
          googleDiagnosticContexts.set(user, diagnostics);
          diagnostics.complete();
          return true;
        }
        diagnostics.start("AUDIT_WRITE", "LOGIN_FAILED");
        await prisma.auditLog.create({
          data: {
            action: "LOGIN_FAILED",
            entity: "Authentication",
            entityId: "google",
            newValue: {
              reason:
                result.status === "pending"
                  ? "APPROVAL_PENDING"
                  : "GOOGLE_ACCESS_DENIED",
            },
          },
        });
        return result.status === "pending" ? "/login?pending=1" : false;
      } catch (error) {
        diagnostics.failed(error);
        return false;
      }
    },
    async redirect({ url, baseUrl }) {
      return safeAuthRedirect(url, baseUrl);
    },
    async jwt({ token, user, trigger, account, profile }) {
      const diagnostics = user ? googleDiagnosticContexts.get(user) : undefined;
      const googleContext =
        diagnostics ||
        (account?.provider === "google"
          ? new GoogleDiagnostics(profile ?? user, account)
          : undefined);
      googleContext?.start("SESSION_CREATE", "jwt_callback");
      try {
        if (user) {
          token.id = user.id;
          token.sessionVersion = user.sessionVersion;
          token.roles = user.roles;
          token.username = user.username;
          token.picture = user.image;
        }
        if (trigger === "update" && token.id) {
          const current = await prisma.user.findUnique({
            where: { id: token.id },
          });
          if (
            current?.active &&
            !current.deletedAt &&
            current.sessionVersion === token.sessionVersion
          ) {
            token.name = current.name;
            token.username = current.username;
            token.picture = current.image;
          }
        }
        googleContext?.complete();
        return token;
      } catch (error) {
        googleContext?.failed(error);
        throw error;
      }
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.sessionVersion = token.sessionVersion;
        session.user.roles = token.roles;
        session.user.username = token.username;
        session.user.image = token.picture;
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
