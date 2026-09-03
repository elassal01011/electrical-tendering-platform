export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  GENERAL_MANAGER: ["*"],
  TENDERING_MANAGER: [
    "project.*",
    "quote.*",
    "boq.*",
    "panel.*",
    "document.*",
    "supplier.view",
    "catalog.view",
    "pricing.view",
  ],
  TENDERING_ENGINEER: [
    "project.view",
    "boq.*",
    "panel.view",
    "catalog.view",
    "document.view",
    "document.upload",
  ],
  ELECTRICAL_DESIGN_ENGINEER: [
    "panel.*",
    "boq.view",
    "boq.review",
    "catalog.view",
    "project.view",
  ],
  ESTIMATOR: [
    "project.view",
    "boq.*",
    "panel.*",
    "pricing.*",
    "quote.view",
    "quote.create",
    "quote.submit",
    "quote.cost.view",
  ],
  PROCUREMENT_ENGINEER: [
    "catalog.*",
    "supplier.*",
    "pricing.*",
    "project.view",
  ],
  SALES_ENGINEER: ["quote.view", "project.view"],
  DOCUMENT_CONTROLLER: ["document.*"],
  STORE_INVENTORY_USER: ["inventory.*"],
  FINANCE_USER: ["pricing.view", "quote.view"],
  CLIENT_USER: [],
  VENDOR_USER: ["supplier.rfq.respond"],
  CONSULTANT_USER: [],
};

export function hasPermission(roles: string[], permission: string): boolean {
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    if (perms.includes("*")) return true;
    for (const p of perms) {
      if (p === permission) return true;
      if (p.endsWith(".*") && permission.startsWith(p.slice(0, -1)))
        return true;
    }
  }
  return false;
}
