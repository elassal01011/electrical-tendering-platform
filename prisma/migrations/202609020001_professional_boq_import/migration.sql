-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'GENERAL_MANAGER', 'TENDERING_MANAGER', 'TENDERING_ENGINEER', 'ELECTRICAL_DESIGN_ENGINEER', 'ESTIMATOR', 'PROCUREMENT_ENGINEER', 'SALES_ENGINEER', 'DOCUMENT_CONTROLLER', 'STORE_INVENTORY_USER', 'FINANCE_USER', 'CLIENT_USER', 'VENDOR_USER', 'CONSULTANT_USER');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CLIENT', 'CONSULTANT', 'MAIN_CONTRACTOR', 'SUBCONTRACTOR', 'VENDOR', 'SUPPLIER', 'MANUFACTURER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'BOQ_ANALYSIS', 'ENGINEERING', 'PRICING', 'INTERNAL_REVIEW', 'SUBMITTED', 'NEGOTIATION', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BOQItemStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "ComponentCategory" AS ENUM ('MCCB', 'MCB', 'ACB', 'RCCB', 'RCBO', 'CONTACTOR', 'OVERLOAD_RELAY', 'SWITCH_DISCONNECTOR', 'FUSE', 'SPD', 'METER', 'CT', 'VFD', 'SOFT_STARTER', 'TERMINAL_BLOCK', 'BUSBAR', 'ENCLOSURE', 'OTHER');

-- CreateEnum
CREATE TYPE "CalcStatus" AS ENUM ('PRELIMINARY', 'ENGINEER_VERIFIED', 'APPROVED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'SENT', 'NEGOTIATION', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "taxNumber" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "preferredCurrency" TEXT DEFAULT 'EGP',
    "paymentTerms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "consultantId" TEXT,
    "location" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Egypt',
    "tenderNumber" TEXT,
    "tenderDeadline" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "targetMarginPct" DECIMAL(6,3) NOT NULL DEFAULT 20,
    "status" "ProjectStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOQ" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BOQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOQItem" (
    "id" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "originalRowNumber" INTEGER,
    "itemNumber" TEXT,
    "manufacturerRequirement" TEXT,
    "modelRequirement" TEXT,
    "remarks" TEXT,
    "isSectionHeader" BOOLEAN NOT NULL DEFAULT false,
    "rawDescription" TEXT NOT NULL,
    "parsedSpec" JSONB,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'NO',
    "status" "BOQItemStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedComponentId" TEXT,
    "matchScore" DECIMAL(5,2),
    "matchReason" TEXT,
    "appliedSupplierPriceId" TEXT,
    "appliedSupplierId" TEXT,
    "appliedUnitPrice" DECIMAL(14,2),
    "appliedCurrency" TEXT,
    "priceAppliedAt" TIMESTAMP(3),
    "priceSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BOQItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ComponentCategory" NOT NULL,
    "voltageV" INTEGER,
    "currentA" DECIMAL(10,2),
    "poles" INTEGER,
    "breakingCapacityKA" DECIMAL(10,2),
    "tripUnit" TEXT,
    "mounting" TEXT,
    "listPrice" DECIMAL(14,2),
    "listPriceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcelMappingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'BOQ',
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcelMappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcelImport" (
    "id" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "mapping" JSONB NOT NULL,
    "importedRows" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcelImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentAccessory" (
    "id" TEXT NOT NULL,
    "parentComponentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "necessity" TEXT NOT NULL,

    CONSTRAINT "ComponentAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPrice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "supplierPartNumber" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'NO',
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDiscount" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "brand" TEXT,
    "category" "ComponentCategory",
    "qtyBandMin" INTEGER NOT NULL DEFAULT 0,
    "qtyBandMax" INTEGER,
    "discountPct" DECIMAL(6,3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "SupplierDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRFQ" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "panelType" TEXT,
    "ipRating" TEXT,
    "ratedVoltageV" INTEGER,
    "faultLevelKA" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelSection" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PanelSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelComponent" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "sectionId" TEXT,
    "componentId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "laborHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overridePrice" DECIMAL(14,2),
    "notes" TEXT,

    CONSTRAINT "PanelComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringCalculation" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "status" "CalcStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineeringCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborRate" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hourlyRate" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LaborRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverheadRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "overheadPct" DECIMAL(6,3) NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OverheadRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "ComponentCategory",
    "markupPct" DECIMAL(6,3),
    "grossMarginPct" DECIMAL(6,3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MarginRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "validUntil" TIMESTAMP(3),
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCost" DECIMAL(16,2),
    "totalSell" DECIMAL(16,2),
    "marginPct" DECIMAL(6,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "unitSell" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRevision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalOffer" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialOffer" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Party_type_companyName_key" ON "Party"("type", "companyName");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_projectId_userId_role_key" ON "ProjectAssignment"("projectId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "BOQ_projectId_name_version_key" ON "BOQ"("projectId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Component_manufacturer_partNumber_key" ON "Component"("manufacturer", "partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExcelMappingTemplate_partyId_purpose_name_key" ON "ExcelMappingTemplate"("partyId", "purpose", "name");

-- CreateIndex
CREATE INDEX "SupplierPrice_componentId_effectiveFrom_effectiveTo_idx" ON "SupplierPrice"("componentId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "SupplierPrice_supplierId_componentId_idx" ON "SupplierPrice"("supplierId", "componentId");

-- CreateIndex
CREATE INDEX "SupplierPrice_supplierId_supplierPartNumber_effectiveFrom_idx" ON "SupplierPrice"("supplierId", "supplierPartNumber", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SupplierPrice_active_effectiveFrom_effectiveTo_idx" ON "SupplierPrice"("active", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierDiscount_supplierId_brand_category_qtyBandMin_key" ON "SupplierDiscount"("supplierId", "brand", "category", "qtyBandMin");

-- CreateIndex
CREATE UNIQUE INDEX "Panel_projectId_code_key" ON "Panel"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LaborRate_label_currency_key" ON "LaborRate"("label", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "OverheadRule_label_key" ON "OverheadRule"("label");

-- CreateIndex
CREATE UNIQUE INDEX "MarginRule_label_key" ON "MarginRule"("label");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_asOf_key" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_projectId_quoteNumber_revision_key" ON "Quote"("projectId", "quoteNumber", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRevision" ADD CONSTRAINT "ProjectRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOQ" ADD CONSTRAINT "BOQ_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOQItem" ADD CONSTRAINT "BOQItem_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "BOQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOQItem" ADD CONSTRAINT "BOQItem_matchedComponentId_fkey" FOREIGN KEY ("matchedComponentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOQItem" ADD CONSTRAINT "BOQItem_appliedSupplierPriceId_fkey" FOREIGN KEY ("appliedSupplierPriceId") REFERENCES "SupplierPrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOQItem" ADD CONSTRAINT "BOQItem_appliedSupplierId_fkey" FOREIGN KEY ("appliedSupplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcelMappingTemplate" ADD CONSTRAINT "ExcelMappingTemplate_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcelImport" ADD CONSTRAINT "ExcelImport_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "BOQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentAccessory" ADD CONSTRAINT "ComponentAccessory_parentComponentId_fkey" FOREIGN KEY ("parentComponentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDiscount" ADD CONSTRAINT "SupplierDiscount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRFQ" ADD CONSTRAINT "SupplierRFQ_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelSection" ADD CONSTRAINT "PanelSection_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelComponent" ADD CONSTRAINT "PanelComponent_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelComponent" ADD CONSTRAINT "PanelComponent_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PanelSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelComponent" ADD CONSTRAINT "PanelComponent_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringCalculation" ADD CONSTRAINT "EngineeringCalculation_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
