import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { getCompany } from "@/lib/company";
import { DEFAULT_PROFILES } from "@/lib/services/pricing/costModel";
import { apiError } from "@/lib/apiError";
export async function GET() {
  try {
    const guard = await requirePermission("quote.create");
    if (guard.error) return guard.error;
    const [company, setting] = await Promise.all([
      getCompany(),
      prisma.systemSetting.findUnique({ where: { key: "pricing.profiles" } }),
    ]);
    const profiles = (setting?.value ??
      DEFAULT_PROFILES) as unknown as typeof DEFAULT_PROFILES;
    return NextResponse.json({
      currency: company.currency,
      vatPct: company.vatPct,
      targetMarginPct: profiles.STANDARD.targetPct,
    });
  } catch (error) {
    return apiError(error, "quotes.defaults");
  }
}
