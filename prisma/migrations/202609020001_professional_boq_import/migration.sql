ALTER TABLE "Party" ADD CONSTRAINT "Party_type_companyName_key" UNIQUE ("type", "companyName");
ALTER TABLE "Component" ADD CONSTRAINT "Component_manufacturer_partNumber_key" UNIQUE ("manufacturer", "partNumber");
ALTER TABLE "BOQ" ADD CONSTRAINT "BOQ_projectId_name_version_key" UNIQUE ("projectId", "name", "version");
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_projectId_code_key" UNIQUE ("projectId", "code");
ALTER TABLE "LaborRate" ADD CONSTRAINT "LaborRate_label_currency_key" UNIQUE ("label", "currency");
ALTER TABLE "OverheadRule" ADD CONSTRAINT "OverheadRule_label_key" UNIQUE ("label");
ALTER TABLE "MarginRule" ADD CONSTRAINT "MarginRule_label_key" UNIQUE ("label");
CREATE UNIQUE INDEX "SupplierDiscount_supplierId_brand_category_qtyBandMin_key" ON "SupplierDiscount"("supplierId", "brand", "category", "qtyBandMin");
ALTER TABLE "BOQItem" ADD COLUMN "originalRowNumber" INTEGER,
ADD COLUMN "itemNumber" TEXT,
ADD COLUMN "manufacturerRequirement" TEXT,
ADD COLUMN "modelRequirement" TEXT,
ADD COLUMN "remarks" TEXT,
ADD COLUMN "isSectionHeader" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ExcelMappingTemplate" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "partyId" TEXT, "purpose" TEXT NOT NULL DEFAULT 'BOQ',
  "mapping" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExcelMappingTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExcelMappingTemplate_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExcelMappingTemplate_partyId_purpose_name_key" ON "ExcelMappingTemplate"("partyId", "purpose", "name");
CREATE TABLE "ExcelImport" (
  "id" TEXT NOT NULL, "boqId" TEXT NOT NULL, "fileName" TEXT NOT NULL, "sheetName" TEXT NOT NULL,
  "headerRow" INTEGER NOT NULL, "mapping" JSONB NOT NULL, "importedRows" INTEGER NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ExcelImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExcelImport_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "BOQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
