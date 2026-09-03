import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/auth/permissions";
export default withAuth(
  function middleware(req) {
    const path = req.nextUrl.pathname;
    const routes: Record<string, string> = {
      dashboard: "project.view",
      projects: "project.view",
      clients: "project.view",
      consultants: "project.view",
      boq: "boq.view",
      pricing: "pricing.view",
      costing: "pricing.view",
      panels: "panel.view",
      components: "catalog.view",
      suppliers: "supplier.view",
      quotations: "quote.view",
      approvals: "quote.approve",
      settings: "settings.edit",
      users: "user.manage",
      roles: "user.manage",
      audit: "audit.view",
      documents: "document.view",
    };
    const permission = routes[path.split("/")[1]];
    if (
      permission &&
      !hasPermission(req.nextauth.token?.roles ?? [], permission)
    )
      return NextResponse.redirect(new URL("/forbidden", req.url));
  },
  { pages: { signIn: "/login" } },
);
// APIs perform their own fresh database/session permission check and return JSON 401/403.
export const config = {
  matcher: [
    "/((?!api/|login(?:/|$)|signup(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
