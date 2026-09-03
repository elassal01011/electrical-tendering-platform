import {
  PrismaClient,
  RoleName,
  ComponentCategory,
  PartyType,
} from "@prisma/client";
import { bootstrapAdmin, BOOTSTRAP_HELP } from "../src/lib/auth/admin";
import { runAdminCommand } from "../scripts/admin-cli";

async function main(prisma: PrismaClient) {
  console.log("Seeding roles...");
  for (const roleName of Object.values(RoleName)) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
    });
  }

  const admin = await bootstrapAdmin(prisma, process.env);
  if (!admin) console.log(BOOTSTRAP_HELP);
  else
    console.log(
      admin.created
        ? "Administrator created with SUPER_ADMIN access."
        : "Administrator active with SUPER_ADMIN access. Existing password preserved; use npm run reset-admin to change it.",
    );

  if (process.env.SEED_DEMO_DATA !== "true") return;
  console.log("Seeding sample client / consultant (SAMPLE DATA)...");
  const client = await prisma.party.upsert({
    where: {
      type_companyName: {
        type: PartyType.CLIENT,
        companyName: "Sample Client",
      },
    },
    update: {},
    create: {
      type: PartyType.CLIENT,
      companyName: "Sample Client",
      country: "Egypt",
      city: "Cairo",
    },
  });
  const consultant = await prisma.party.upsert({
    where: {
      type_companyName: {
        type: PartyType.CONSULTANT,
        companyName: "Sample Consultant",
      },
    },
    update: {},
    create: {
      type: PartyType.CONSULTANT,
      companyName: "Sample Consultant",
      country: "Egypt",
      city: "Cairo",
    },
  });
  const supplierSchneider = await prisma.party.upsert({
    where: {
      type_companyName: {
        type: PartyType.SUPPLIER,
        companyName: "Sample Schneider Distributor (SAMPLE)",
      },
    },
    update: {},
    create: {
      type: PartyType.SUPPLIER,
      companyName: "Sample Schneider Distributor (SAMPLE)",
      country: "Egypt",
    },
  });
  const supplierABB = await prisma.party.upsert({
    where: {
      type_companyName: {
        type: PartyType.SUPPLIER,
        companyName: "Sample ABB Distributor (SAMPLE)",
      },
    },
    update: {},
    create: {
      type: PartyType.SUPPLIER,
      companyName: "Sample ABB Distributor (SAMPLE)",
      country: "Egypt",
    },
  });

  console.log("Seeding demo project: Zed Towers - Phase 4 (SAMPLE DATA)...");
  const project = await prisma.project.upsert({
    where: { code: "ZED-P4-001" },
    update: {},
    create: {
      code: "ZED-P4-001",
      name: "Zed Towers - Phase 4",
      clientId: client.id,
      consultantId: consultant.id,
      location: "New Cairo",
      country: "Egypt",
      currency: "EGP",
      targetMarginPct: 20,
      status: "BOQ_ANALYSIS",
    },
  });

  console.log(
    "Seeding component catalog (SAMPLE — not real supplier prices)...",
  );
  const componentsData = [
    {
      manufacturer: "Schneider Electric",
      partNumber: "NSX250F-LSI",
      description: "Compact NSX250F MCCB, 4P, 250A, 36kA, Electronic LSI trip",
      category: ComponentCategory.MCCB,
      voltageV: 415,
      currentA: 250,
      poles: 4,
      breakingCapacityKA: 36,
      tripUnit: "ELECTRONIC_LSI",
      listPrice: 850,
      listPriceCurrency: "USD",
      tags: ["MCCB", "adjustable"],
    },
    {
      manufacturer: "ABB",
      partNumber: "T5N250-LSI",
      description: "Tmax T5N250 MCCB, 4P, 250A, 36kA, Electronic LSI trip",
      category: ComponentCategory.MCCB,
      voltageV: 415,
      currentA: 250,
      poles: 4,
      breakingCapacityKA: 36,
      tripUnit: "ELECTRONIC_LSI",
      listPrice: 790,
      listPriceCurrency: "USD",
      tags: ["MCCB", "adjustable"],
    },
    {
      manufacturer: "Siemens",
      partNumber: "3VA1225-2ED",
      description: "3VA1 MCCB, 4P, 225A, 25kA, thermal-magnetic trip",
      category: ComponentCategory.MCCB,
      voltageV: 415,
      currentA: 225,
      poles: 4,
      breakingCapacityKA: 25,
      tripUnit: "THERMAL_MAGNETIC",
      listPrice: 610,
      listPriceCurrency: "USD",
      tags: ["MCCB"],
    },
    {
      manufacturer: "ABB",
      partNumber: "E1.2B1600-65kA",
      description: "Emax E1.2B ACB, 4P, 1600A, 65kA, draw-out",
      category: ComponentCategory.ACB,
      voltageV: 415,
      currentA: 1600,
      poles: 4,
      breakingCapacityKA: 65,
      tripUnit: "ELECTRONIC_LSIG",
      listPrice: 4200,
      listPriceCurrency: "USD",
      tags: ["ACB", "draw-out"],
    },
    {
      manufacturer: "Schneider Electric",
      partNumber: "iC60N-100-3P",
      description: "Acti9 iC60N MCB, 3P, 100A, 10kA curve C",
      category: ComponentCategory.MCB,
      voltageV: 415,
      currentA: 100,
      poles: 3,
      breakingCapacityKA: 10,
      listPrice: 65,
      listPriceCurrency: "USD",
      tags: ["MCB"],
    },
    {
      manufacturer: "Schneider Electric",
      partNumber: "iID-63-4P-30mA",
      description: "Acti9 iID RCCB, 4P, 63A, 30mA",
      category: ComponentCategory.RCCB,
      voltageV: 415,
      currentA: 63,
      poles: 4,
      listPrice: 95,
      listPriceCurrency: "USD",
      tags: ["RCCB"],
    },
  ];

  const components = [];
  for (const c of componentsData) {
    components.push(
      await prisma.component.upsert({
        where: {
          manufacturer_partNumber: {
            manufacturer: c.manufacturer,
            partNumber: c.partNumber,
          },
        },
        update: c,
        create: c,
      }),
    );
  }

  console.log("Seeding supplier discounts (SAMPLE)...");
  for (const d of [
    {
      supplierId: supplierSchneider.id,
      brand: "Schneider Electric",
      qtyBandMin: 0,
      discountPct: 22,
    },
    {
      supplierId: supplierABB.id,
      brand: "ABB",
      qtyBandMin: 0,
      discountPct: 18,
    },
  ]) {
    const existing = await prisma.supplierDiscount.findFirst({
      where: {
        supplierId: d.supplierId,
        brand: d.brand,
        category: null,
        qtyBandMin: 0,
      },
    });
    if (existing)
      await prisma.supplierDiscount.update({
        where: { id: existing.id },
        data: { discountPct: d.discountPct },
      });
    else await prisma.supplierDiscount.create({ data: d });
  }

  console.log("Seeding labor rate / overhead / margin rules (SAMPLE)...");
  await prisma.laborRate.upsert({
    where: {
      label_currency: { label: "Panel Assembly Technician", currency: "EGP" },
    },
    update: { hourlyRate: 150 },
    create: {
      label: "Panel Assembly Technician",
      hourlyRate: 150,
      currency: "EGP",
    },
  });
  await prisma.overheadRule.upsert({
    where: { label: "Standard Workshop Overhead" },
    update: { overheadPct: 12 },
    create: { label: "Standard Workshop Overhead", overheadPct: 12 },
  });
  await prisma.marginRule.upsert({
    where: { label: "Default Markup" },
    update: { markupPct: 20 },
    create: { label: "Default Markup", markupPct: 20 },
  });

  console.log("Seeding currency rates / pricing profile (SAMPLE)...");
  const rateDate = new Date("2026-01-01T00:00:00.000Z");
  for (const rate of [
    { baseCurrency: "EGP", quoteCurrency: "EGP", rate: 1 },
    { baseCurrency: "USD", quoteCurrency: "EGP", rate: 50 },
  ]) {
    await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_asOf: {
          baseCurrency: rate.baseCurrency,
          quoteCurrency: rate.quoteCurrency,
          asOf: rateDate,
        },
      },
      update: { rate: rate.rate },
      create: { ...rate, asOf: rateDate },
    });
  }
  await prisma.systemSetting.upsert({
    where: { key: "pricing.profile.standard" },
    update: { value: { mode: "GROSS_MARGIN", targetGrossMarginPct: 20 } },
    create: {
      key: "pricing.profile.standard",
      value: { mode: "GROSS_MARGIN", targetGrossMarginPct: 20 },
    },
  });

  console.log("Seeding panels: MDB-01, SMDB-01, DB-01...");
  const mdb01 = await prisma.panel.upsert({
    where: { projectId_code: { projectId: project.id, code: "MDB-01" } },
    update: {},
    create: {
      projectId: project.id,
      code: "MDB-01",
      name: "Main Distribution Board 1",
      ratedVoltageV: 415,
      faultLevelKA: 65,
    },
  });
  await prisma.panel.upsert({
    where: { projectId_code: { projectId: project.id, code: "SMDB-01" } },
    update: {},
    create: {
      projectId: project.id,
      code: "SMDB-01",
      name: "Sub Main Distribution Board 1",
    },
  });
  await prisma.panel.upsert({
    where: { projectId_code: { projectId: project.id, code: "DB-01" } },
    update: {},
    create: {
      projectId: project.id,
      code: "DB-01",
      name: "Distribution Board 1",
    },
  });

  await prisma.panelComponent.deleteMany({ where: { panelId: mdb01.id } });
  await prisma.panelComponent.createMany({
    data: [
      {
        panelId: mdb01.id,
        componentId: components[3].id,
        quantity: 1,
        laborHours: 8,
      }, // ACB incomer
      {
        panelId: mdb01.id,
        componentId: components[0].id,
        quantity: 4,
        laborHours: 2,
      }, // MCCB outgoing x4
      {
        panelId: mdb01.id,
        componentId: components[5].id,
        quantity: 6,
        laborHours: 1,
      }, // RCCB
    ],
  });

  console.log(
    "Seeding BOQ with example lines demonstrating the matching workflow...",
  );
  const boq = await prisma.bOQ.upsert({
    where: {
      projectId_name_version: {
        projectId: project.id,
        name: "MDB-01 BOQ (from tender documents)",
        version: 1,
      },
    },
    update: {},
    create: {
      projectId: project.id,
      name: "MDB-01 BOQ (from tender documents)",
      sourceType: "MANUAL",
      items: {
        create: [
          {
            lineNo: 1,
            rawDescription: "250A MCCB, 4P, 36kA, adjustable trip, Schneider",
            quantity: 4,
            unit: "NO",
            status: "UNMATCHED",
          },
          {
            lineNo: 2,
            rawDescription: "1600A ACB 4P 65kA 415V ABB draw-out",
            quantity: 1,
            unit: "NO",
            status: "UNMATCHED",
          },
        ],
      },
    },
  });
  console.log(
    `Seeded BOQ ${boq.id} — open it in the app and click "Run Automatic Component Matching".`,
  );

  console.log("\nSeed complete.");
  console.log("Seed complete. Existing account passwords were preserved.");
}

void runAdminCommand(main);
