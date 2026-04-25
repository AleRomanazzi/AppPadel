-- CreateTable
CREATE TABLE "Player" (
  "id" SERIAL PRIMARY KEY,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nickname" TEXT NOT NULL UNIQUE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL
);

CREATE TABLE "BlacklistPair" (
  "id" SERIAL PRIMARY KEY,
  "playerAId" INT NOT NULL,
  "playerBId" INT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("playerAId", "playerBId")
);

CREATE TABLE "PartnerHistory" (
  "id" SERIAL PRIMARY KEY,
  "playerAId" INT NOT NULL,
  "playerBId" INT NOT NULL,
  "dateId" INT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("playerAId", "playerBId")
);

CREATE TABLE "TournamentDate" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "eventDate" TIMESTAMP NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DateRegistration" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "playerId" INT NOT NULL REFERENCES "Player" ("id") ON DELETE CASCADE,
  UNIQUE ("dateId", "playerId")
);

CREATE TABLE "DateDraw" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DrawPair" (
  "id" SERIAL PRIMARY KEY,
  "drawId" INT NOT NULL REFERENCES "DateDraw" ("id") ON DELETE CASCADE,
  "player1" INT NOT NULL,
  "player2" INT NOT NULL
);

CREATE TABLE "DateSeed" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "playerId" INT NOT NULL,
  UNIQUE ("dateId", "playerId")
);

CREATE TABLE "Zone" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "size" INT NOT NULL
);

CREATE TABLE "ZoneMatch" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "zoneName" TEXT NOT NULL,
  "pairAPlayer1" INT NOT NULL,
  "pairAPlayer2" INT NOT NULL,
  "pairBPlayer1" INT NOT NULL,
  "pairBPlayer2" INT NOT NULL,
  "score" TEXT,
  "winnerPairKey" TEXT
);

CREATE TABLE "RankingPointEntry" (
  "id" SERIAL PRIMARY KEY,
  "playerId" INT NOT NULL REFERENCES "Player" ("id") ON DELETE CASCADE,
  "points" INT NOT NULL,
  "reason" TEXT NOT NULL,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
