/*
  Warnings:

  - Added the required column `updatedAt` to the `MessageTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "waitReason" TEXT;

-- AlterTable
ALTER TABLE "CampaignMessage" ADD COLUMN     "notBefore" TIMESTAMP(3),
ADD COLUMN     "optedOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "buttons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "purpose" "CampaignKind" NOT NULL DEFAULT 'MARKETING',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "metaId" DROP NOT NULL,
ALTER COLUMN "lastSyncedAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CampaignMessage_sentAt_idx" ON "CampaignMessage"("sentAt");

-- CreateIndex
CREATE INDEX "Contact_sourceDetail_idx" ON "Contact"("sourceDetail");
