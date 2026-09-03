BEGIN;
-- Do not silently merge or delete legacy identities.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized user emails exist. Resolve them before applying the signup migration.';
  END IF;
END $$;
UPDATE "User" SET "email" = lower(btrim("email"));
ALTER TABLE "User"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "image" TEXT,
  ADD COLUMN "emailVerified" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "approvalPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "registrationMethod" TEXT NOT NULL DEFAULT 'admin';
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
-- Canonical storage plus existing unique indexes protects case-insensitive
-- uniqueness, including concurrent writers outside the application.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized"
  CHECK ("email" = lower(btrim("email")));
ALTER TABLE "User" ADD CONSTRAINT "User_username_format"
  CHECK ("username" IS NULL OR ("username" = lower("username") AND "username" ~ '^[a-z0-9_.]{3,30}$'));
CREATE TABLE "OAuthAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");
CREATE UNIQUE INDEX "OAuthAccount_userId_provider_key" ON "OAuthAccount"("userId", "provider");
INSERT INTO "Role" ("id", "name", "description") VALUES
  ('esolutions-standard-user', 'E_SOLUTIONS_USER', 'Tendering workspace access without security or user administration')
  ON CONFLICT ("name") DO NOTHING;
COMMIT;
