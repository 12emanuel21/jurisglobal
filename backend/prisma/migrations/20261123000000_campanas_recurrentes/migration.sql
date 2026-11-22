-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "CampaignSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "variableMapping" JSONB NOT NULL,
    "audienceFilter" JSONB NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "ScheduleFrequency" NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dayOfMonth" INTEGER,
    "timeOfDay" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastSkipReason" TEXT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignSchedule_isActive_nextRunAt_idx" ON "CampaignSchedule"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "Campaign_scheduleId_idx" ON "Campaign"("scheduleId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "CampaignSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
