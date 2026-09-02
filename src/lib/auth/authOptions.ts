import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { roles: { include: { role: true } } },
        });
        if (!user || !user.active) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
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
        token.roles = user.roles;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.roles = token.roles;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

/** Simple permission check helper used by API routes. Extend the map as
 * more permission keys are needed — see Prisma Permission model for the
 * full architecture this is designed to grow into. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  GENERAL_MANAGER: ["*"],
  TENDERING_MANAGER: ["project.*", "quote.*", "boq.*", "panel.*"],
  TENDERING_ENGINEER: ["project.view", "boq.*", "panel.view"],
  ELECTRICAL_DESIGN_ENGINEER: ["panel.*", "boq.view", "catalog.view"],
  ESTIMATOR: ["boq.*", "panel.*", "pricing.*", "quote.*"],
  PROCUREMENT_ENGINEER: ["catalog.*", "supplier.*", "pricing.*"],
  SALES_ENGINEER: ["quote.view", "project.view"],
  DOCUMENT_CONTROLLER: ["document.*"],
  STORE_INVENTORY_USER: ["inventory.*"],
  FINANCE_USER: ["pricing.view", "quote.view"],
  CLIENT_USER: ["project.view"],
  VENDOR_USER: ["supplier.rfq.respond"],
  CONSULTANT_USER: ["project.view"],
};

export function hasPermission(roles: string[], permission: string): boolean {
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    if (perms.includes("*")) return true;
    for (const p of perms) {
      if (p === permission) return true;
      if (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))) return true;
    }
  }
  return false;
}
