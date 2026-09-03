import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
const type = z.enum(["CLIENT", "CONSULTANT", "SUPPLIER"]);
const schema = z.object({
  type,
  companyName: z.string().trim().min(1).max(150),
  contactName: z.string().max(100).optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
  preferredCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EGP"),
});
export async function GET(req: NextRequest) {
  try {
    const selected = type.parse(
      req.nextUrl.searchParams.get("type") || "CLIENT",
    );
    const g = await requirePermission(
      selected === "SUPPLIER" ? "supplier.view" : "project.view",
    );
    if (g.error) return g.error;
    const q = req.nextUrl.searchParams.get("q") || "";
    const rows = await prisma.party.findMany({
      where: {
        type: selected,
        deletedAt: null,
        companyName: { contains: q, mode: "insensitive" },
      },
      orderBy: { companyName: "asc" },
      take: 100,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return apiError(e, "parties.list");
  }
}
export async function POST(req: Request) {
  try {
    const data = schema.parse(await req.json());
    const g = await requirePermission(
      data.type === "SUPPLIER" ? "supplier.edit" : "project.create",
    );
    if (g.error) return g.error;
    const row = await prisma.$transaction(async (tx) => {
      const p = await tx.party.create({ data });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "PARTY_CREATED",
          entity: "Party",
          entityId: p.id,
          newValue: data,
        },
      });
      return p;
    });
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return apiError(e, "parties.create");
  }
}
