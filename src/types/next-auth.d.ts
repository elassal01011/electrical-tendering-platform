import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    username?: string | null;
    roles: string[];
    sessionVersion: number;
  }
  interface Session {
    user: {
      id: string;
      roles: string[];
      sessionVersion: number;
      username?: string | null;
      image?: string | null;
      name?: string | null;
      email?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    username?: string | null;
    id: string;
    roles: string[];
    sessionVersion: number;
  }
}
