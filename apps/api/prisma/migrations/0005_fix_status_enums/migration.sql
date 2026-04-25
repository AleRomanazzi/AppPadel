DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DateStatus') THEN
    CREATE TYPE "DateStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DrawStatus') THEN
    CREATE TYPE "DrawStatus" AS ENUM ('DRAFT', 'CONFIRMED');
  END IF;
END $$;

ALTER TABLE "TournamentDate"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DateStatus" USING "status"::"DateStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "DateDraw"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DrawStatus" USING "status"::"DrawStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
