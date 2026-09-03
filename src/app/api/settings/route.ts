import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompany } from "@/lib/company";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
const schema = z.object({
  companyName: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(100),
  logo: z
    .string()
    .max(400000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .nullable(),
  email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().max(50),
  website: z.union([
    z
      .string()
      .url()
      .regex(/^https?:\/\//),
    z.literal(""),
  ]),
  address: z.string().max(1000),
  taxNumber: z.string().max(100),
  commercialRegistration: z.string().max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  country: z.string().max(100),
  quotationPrefix: z.string().regex(/^[A-Z0-9-]{1,12}$/),
  minimumMarginPct: z.number().min(0).max(99),
  vatPct: z.number().min(0).max(100),
});
export async function GET() {
  try {
    const guard = await requirePermission("settings.edit");
    if (guard.error) return guard.error;
    return NextResponse.json({ company: await getCompany() });
  } catch (e) {
    return apiError(e, "settings.get");
  }
}
export async function PUT(req: Request) {
  try {
    const guard = await requirePermission("settings.edit");
    if (guard.error) return guard.error;
    const data = schema.parse(await req.json());
    const company = await prisma.$transaction(async (tx) => {
      const row = await tx.companySettings.upsert({
        where: { id: "company" },
        create: { id: "company", ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId,
          action: "COMPANY_UPDATED",
          entity: "CompanySettings",
          entityId: "company",
          newValue: { ...data, logo: data.logo ? "Logo uploaded" : null },
        },
      });
      return row;
    });
    return NextResponse.json({ company });
  } catch (e) {
    return apiError(e, "settings.update");
  }
}
