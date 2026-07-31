-- AlterTable
ALTER TABLE "TournamentDate" ADD COLUMN "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RankingPointEntry" ADD COLUMN "dateId" INTEGER;
