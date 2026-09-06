ALTER TABLE "BOQ" ADD COLUMN "description" TEXT;
ALTER TABLE "BOQ" ADD COLUMN "currency" TEXT DEFAULT 'EGP';
UPDATE "BOQ" SET "currency" = "Project"."currency"
FROM "Project" WHERE "BOQ"."projectId" = "Project"."id";
ALTER TABLE "BOQ" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "BOQ" ALTER COLUMN "version" SET DEFAULT 0;
DROP INDEX IF EXISTS "ExcelUpload_importedBoqId_key";
CREATE INDEX "ExcelUpload_importedBoqId_idx" ON "ExcelUpload"("importedBoqId");
