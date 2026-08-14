-- CreateEnum
CREATE TYPE "PlayerTier" AS ENUM ('ABUSO', 'MORTAL');
CREATE TYPE "PairingMode" AS ENUM ('FECHA_LIBRE', 'ABUSO_MORTAL');

ALTER TABLE "Player" ADD COLUMN "tier" "PlayerTier" NOT NULL DEFAULT 'MORTAL';
ALTER TABLE "TournamentDate" ADD COLUMN "pairingMode" "PairingMode" NOT NULL DEFAULT 'ABUSO_MORTAL';

UPDATE "Player"
SET "tier" = 'ABUSO'
WHERE "division" = 'MEN'
  AND lower(trim("nickname")) IN (
  'tucu',
  'humi',
  'roma',
  'nico',
  'aruj',
  'fer castro',
  'pipita',
  'maty zurdo',
  'chacoma',
  'profe',
  'emilio'
);
