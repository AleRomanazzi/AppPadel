-- CreateEnum
CREATE TYPE "Division" AS ENUM ('MEN', 'WOMEN');

-- CreateTable
CREATE TABLE "TournamentEvent" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentEvent_pkey" PRIMARY KEY ("id")
);

-- Migrate existing dates into events (1:1)
INSERT INTO "TournamentEvent" ("name", "eventDate", "createdAt")
SELECT "name", "eventDate", "createdAt"
FROM "TournamentDate"
ORDER BY "id";

ALTER TABLE "TournamentDate" ADD COLUMN "eventId" INTEGER;
ALTER TABLE "TournamentDate" ADD COLUMN "division" "Division";

WITH ranked_dates AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS rn
    FROM "TournamentDate"
),
ranked_events AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS rn
    FROM "TournamentEvent"
)
UPDATE "TournamentDate" AS d
SET "eventId" = e."id", "division" = 'MEN'
FROM ranked_dates rd
JOIN ranked_events re ON rd.rn = re.rn
WHERE d."id" = rd."id";

ALTER TABLE "TournamentDate" ALTER COLUMN "eventId" SET NOT NULL;
ALTER TABLE "TournamentDate" ALTER COLUMN "division" SET NOT NULL;

ALTER TABLE "TournamentDate" DROP COLUMN "name";
ALTER TABLE "TournamentDate" DROP COLUMN "eventDate";

ALTER TABLE "TournamentDate" ADD CONSTRAINT "TournamentDate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "TournamentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TournamentDate_eventId_division_key" ON "TournamentDate"("eventId", "division");

-- Player: division + composite unique nickname
ALTER TABLE "Player" ADD COLUMN "division" "Division" NOT NULL DEFAULT 'MEN';

DROP INDEX IF EXISTS "Player_nickname_key";
CREATE UNIQUE INDEX "Player_division_nickname_key" ON "Player"("division", "nickname");

-- PartnerHistory: division + composite unique
ALTER TABLE "PartnerHistory" ADD COLUMN "division" "Division" NOT NULL DEFAULT 'MEN';

DROP INDEX IF EXISTS "PartnerHistory_playerAId_playerBId_key";
CREATE UNIQUE INDEX "PartnerHistory_division_playerAId_playerBId_key"
    ON "PartnerHistory"("division", "playerAId", "playerBId");
