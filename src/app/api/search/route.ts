import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { hasPermission } from "@/lib/auth/permissions";
import { apiError } from "@/lib/apiError";
export async function GET(req: NextRequest) {
  try {
    const g = await requirePermission("account.view");
    if (g.error) return g.error;
    const q = (req.nextUrl.searchParams.get("q") || "").slice(0, 120);
    if (q.length < 2) return NextResponse.json({ results: [] });
    const can = (p: string) => hasPermission(g.session!.user.roles, p);
    const contains = { contains: q, mode: "insensitive" as const };
    const [projects, quotes, components, parties, items] = await Promise.all([
      can("project.view")
        ? prisma.project.findMany({
            where: {
              deletedAt: null,
              OR: [
                { code: contains },
                { name: contains },
                { tenderNumber: contains },
                { client: { companyName: contains } },
                { consultant: { companyName: contains } },
              ],
            },
            take: 6,
          })
        : [],
      can("quote.view")
        ? prisma.quote.findMany({
            where: { quoteNumber: contains },
            take: 6,
            orderBy: { revision: "desc" },
          })
        : [],
      can("catalog.view")
        ? prisma.component.findMany({
            where: {
              active: true,
              OR: [
                { partNumber: contains },
                { description: contains },
                { manufacturer: contains },
              ],
            },
            take: 6,
          })
        : [],
      can("supplier.view")
        ? prisma.party.findMany({
            where: { type: "SUPPLIER", deletedAt: null, companyName: contains },
            take: 6,
          })
        : [],
      can("boq.view")
        ? prisma.bOQItem.findMany({
            where: { rawDescription: contains },
            take: 6,
          })
        : [],
    ]);
    return NextResponse.json({
      results: [
        ...projects.map((p) => ({
          group: "Projects",
          label: p.code + " · " + p.name,
          href: "/projects/" + p.id,
        })),
        ...quotes.map((q) => ({
          group: "Quotations",
          label: q.quoteNumber + " · Rev " + q.revision,
          href: "/quotations/" + q.id,
        })),
        ...components.map((c) => ({
          group: "Components",
          label: c.partNumber + " · " + c.manufacturer,
          href: "/components?q=" + encodeURIComponent(c.partNumber),
        })),
        ...parties.map((p) => ({
          group: "Suppliers",
          label: p.companyName,
          href: "/suppliers?q=" + encodeURIComponent(p.companyName),
        })),
        ...items.map((i) => ({
          group: "BOQ",
          label: i.rawDescription,
          href: "/boq?boqId=" + i.boqId,
        })),
      ],
    });
  } catch (e) {
    return apiError(e, "search");
  }
}
