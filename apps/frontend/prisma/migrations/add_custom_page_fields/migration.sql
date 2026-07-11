-- AlterTable
ALTER TABLE "CustomPage" ADD COLUMN "description" TEXT,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "pagePurpose" TEXT DEFAULT 'informational',
ADD COLUMN "parcelType" TEXT DEFAULT 'standard';

-- CreateIndex
CREATE INDEX "CustomPage_pagePurpose_idx" ON "CustomPage"("pagePurpose");

-- CreateIndex
CREATE INDEX "CustomPage_parcelType_idx" ON "CustomPage"("parcelType");
