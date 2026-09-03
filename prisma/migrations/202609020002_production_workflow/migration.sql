-- Additive migration. Existing data and the original migration are preserved.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ExcelUpload" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "importedBoqId" TEXT, CONSTRAINT "ExcelUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExcelUpload_importedBoqId_key" ON "ExcelUpload"("importedBoqId");
CREATE INDEX "ExcelUpload_userId_expiresAt_idx" ON "ExcelUpload"("userId","expiresAt");
CREATE TABLE "ExcelUploadChunk" (
  "uploadId" TEXT NOT NULL, "index" INTEGER NOT NULL, "bytes" BYTEA NOT NULL,
  CONSTRAINT "ExcelUploadChunk_pkey" PRIMARY KEY ("uploadId","index"),
  CONSTRAINT "ExcelUploadChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ExcelUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "LoginAttempt" (
  "key" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "LoginAttempt_expiresAt_idx" ON "LoginAttempt"("expiresAt");
CREATE TABLE "CompanySettings" (
  "id" TEXT NOT NULL DEFAULT 'company', "companyName" TEXT NOT NULL DEFAULT 'E-SOLUTIONS',
  "productName" TEXT NOT NULL DEFAULT 'E-SOLUTIONS Tendering', "logo" TEXT,
  "email" TEXT NOT NULL DEFAULT '', "phone" TEXT NOT NULL DEFAULT '', "website" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '', "taxNumber" TEXT NOT NULL DEFAULT '',
  "commercialRegistration" TEXT NOT NULL DEFAULT '', "currency" TEXT NOT NULL DEFAULT 'EGP',
  "country" TEXT NOT NULL DEFAULT 'Egypt', "quotationPrefix" TEXT NOT NULL DEFAULT 'QTN',
  "minimumMarginPct" DECIMAL(6,3) NOT NULL DEFAULT 15, "vatPct" DECIMAL(6,3) NOT NULL DEFAULT 14,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DocumentSequence" (
  "key" TEXT NOT NULL, "value" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "Quote" ADD COLUMN "discountPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN "vatPct" DECIMAL(6,3) NOT NULL DEFAULT 0, ADD COLUMN "terms" JSONB,
  ADD COLUMN "companySnapshot" JSONB, ADD COLUMN "createdBy" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN "manufacturer" TEXT, ADD COLUMN "partNumber" TEXT,
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'NO';
ALTER TABLE "Document" ADD COLUMN "bytes" BYTEA, ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN "deletedAt" TIMESTAMP(3);
-- If legacy documents already contain duplicate revision numbers, reconcile them before migration.
CREATE UNIQUE INDEX "Document_projectId_fileName_version_key" ON "Document"("projectId","fileName","version");
