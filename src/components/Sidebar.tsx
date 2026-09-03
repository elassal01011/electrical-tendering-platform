"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/boq", label: "BOQ Import & Matching" },
  { href: "/pricing", label: "Supplier Pricing" },
  { href: "/panels", label: "Panels / BOM" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-6 px-2">
        <div className="text-sm font-semibold text-brand-100">
          Electrical Tendering
        </div>
        <div className="text-xs text-slate-500">CPQ & Panel Engineering</div>
      </div>
      <nav className="space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "block rounded-md px-3 py-2 text-sm",
              pathname?.startsWith(item.href)
                ? "bg-brand-500/20 text-brand-100"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
