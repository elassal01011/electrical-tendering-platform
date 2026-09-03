import { prisma } from "./db/prisma";
import { DEFAULT_COMPANY } from "./companyDefaults";
export { DEFAULT_COMPANY } from "./companyDefaults";
export async function getCompany() {
  const row = await prisma.companySettings.findUnique({
    where: { id: "company" },
  });
  return row
    ? {
        ...row,
        minimumMarginPct: Number(row.minimumMarginPct),
        vatPct: Number(row.vatPct),
      }
    : DEFAULT_COMPANY;
}
