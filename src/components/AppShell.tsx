"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { Brand, BrandProvider } from "./Brand";
import { hasPermission } from "@/lib/auth/permissions";
import { Avatar } from "./Avatar";
import { CommandPalette } from "./CommandPalette";
const navigation = [
  [
    "OVERVIEW",
    [
      ["/dashboard", "Dashboard", "project.view"],
      ["/projects", "Projects & tenders", "project.view"],
    ],
  ],
  [
    "SALES & ENGINEERING",
    [
      ["/clients", "Clients", "project.view"],
      ["/consultants", "Consultants", "project.view"],
      ["/boq", "BOQ analysis", "boq.view"],
      ["/components", "Component catalog", "catalog.view"],
      ["/panels", "Panel builder", "panel.view"],
    ],
  ],
  [
    "COMMERCIAL",
    [
      ["/quotations", "Quotations", "quote.view"],
      ["/approvals", "Approval center", "quote.approve"],
      ["/suppliers", "Suppliers", "supplier.view"],
      ["/pricing", "Supplier prices", "pricing.view"],
      ["/costing", "Smart pricing", "pricing.view"],
    ],
  ],
  ["OPERATIONS", [["/documents", "Documents", "document.view"]]],
  [
    "ADMINISTRATION",
    [
      ["/users", "Users", "user.manage"],
      ["/roles", "Roles & permissions", "user.manage"],
      ["/audit", "Audit logs", "audit.view"],
      ["/settings", "Company settings", "settings.edit"],
    ],
  ],
] as const;
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(false),
    [theme, setTheme] = useState("system");
  useEffect(() => {
    setTheme(localStorage.getItem("es-theme") || "system");
    setCollapsed(localStorage.getItem("es-sidebar") === "collapsed");
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    localStorage.setItem("es-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if (e.key === "Escape") {
        setSearch(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    setMobile(false);
    setSearch(false);
  }, [path]);
  return (
    <BrandProvider>
      {path === "/login" || path === "/signup" ? (
        children
      ) : (
        <div className={"app-shell " + (collapsed ? "is-collapsed" : "")}>
          {mobile && (
            <button
              className="sidebar-backdrop"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            />
          )}
          <aside className={"app-sidebar " + (mobile ? "is-open" : "")}>
            <Link href="/dashboard" className="sidebar-brand">
              <Brand compact={collapsed} />
            </Link>
            <nav aria-label="Main navigation">
              {navigation.map(([section, items]) => {
                const allowed = items.filter((item) =>
                  hasPermission(session?.user.roles ?? [], item[2]),
                );
                return allowed.length ? (
                  <div className="nav-group" key={section}>
                    {!collapsed && <p>{section}</p>}
                    {allowed.map(([href, label], i) => (
                      <Link
                        href={href}
                        key={href}
                        title={label}
                        aria-current={
                          path.startsWith(href) ? "page" : undefined
                        }
                        className={path.startsWith(href) ? "active" : ""}
                      >
                        <svg
                          aria-hidden="true"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        >
                          <rect
                            x="4"
                            y="4"
                            width="16"
                            height="16"
                            rx={i % 2 ? 3 : 1}
                          />
                          <path
                            d={
                              i % 2
                                ? "M8 9h8M8 13h8M8 17h5"
                                : "M4 10h16M10 10v10"
                            }
                          />
                        </svg>
                        {!collapsed && label}
                      </Link>
                    ))}
                  </div>
                ) : null;
              })}
            </nav>
            <button
              className="collapse-button"
              onClick={() => {
                setCollapsed(!collapsed);
                localStorage.setItem(
                  "es-sidebar",
                  !collapsed ? "collapsed" : "expanded",
                );
              }}
              aria-label={
                collapsed ? "Expand navigation" : "Collapse navigation"
              }
            >
              {collapsed ? "»" : "«  Collapse sidebar"}
            </button>
          </aside>
          <div className="app-main">
            <header className="topbar">
              <button
                className="btn-secondary mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                ☰
              </button>
              <div className="hidden md:block">
                <span className="muted text-xs">WORKSPACE</span>
                <div className="text-sm font-medium">
                  Tendering & engineering
                </div>
              </div>
              <button
                className="search-trigger"
                onClick={() => setSearch(true)}
              >
                ⌕ <span>Search projects, parts, quotations…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <label className="sr-only" htmlFor="theme">
                Color theme
              </label>
              <select
                id="theme"
                className="theme-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              <details className="user-menu">
                <summary>
                  <Avatar
                    name={session?.user.name}
                    image={session?.user.image}
                  />
                  <span className="hidden lg:inline">
                    {session?.user.name || "Account"}
                  </span>
                </summary>
                <div>
                  <Link href="/account">Profile & password</Link>
                  <button onClick={() => signOut({ callbackUrl: "/login" })}>
                    Sign out
                  </button>
                </div>
              </details>
            </header>
            <main id="main-content">{children}</main>
            <footer className="app-footer">
              Electrical Tendering · CPQ · Panel Engineering
              <span>Engineer verification required for all selections</span>
            </footer>
          </div>
          {search && <CommandPalette close={() => setSearch(false)} />}
        </div>
      )}
    </BrandProvider>
  );
}
