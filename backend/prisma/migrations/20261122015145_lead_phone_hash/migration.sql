/*
  Warnings:

  - Added the required column `phoneHash` to the `Lead` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "phoneHash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Lead_phoneHash_idx" ON "Lead"("phoneHash");
