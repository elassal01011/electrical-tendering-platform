ALTER TABLE "BOQItem"
  ADD COLUMN "manualBaseUnitCost" DECIMAL(14,2),
  ADD COLUMN "manualDiscountPct" DECIMAL(6,3),
  ADD COLUMN "manualSupplierReference" TEXT,
  ADD COLUMN "manualLeadTimeDays" INTEGER,
  ADD COLUMN "manualValidUntil" TIMESTAMP(3),
  ADD COLUMN "manualPriceNotes" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN "priceSource" TEXT;
