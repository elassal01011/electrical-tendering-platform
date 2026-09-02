import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User { roles: string[] }
  interface Session { user: { id: string; roles: string[]; name?: string | null; email?: string | null } }
}

declare module "next-auth/jwt" {
  interface JWT { id: string; roles: string[] }
}
