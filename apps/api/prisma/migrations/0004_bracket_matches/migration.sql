CREATE TABLE "BracketMatch" (
  "id" SERIAL PRIMARY KEY,
  "dateId" INT NOT NULL REFERENCES "TournamentDate" ("id") ON DELETE CASCADE,
  "round" INT NOT NULL,
  "position" INT NOT NULL,
  "pairAPlayer1" INT,
  "pairAPlayer2" INT,
  "pairBPlayer1" INT,
  "pairBPlayer2" INT,
  "score" TEXT,
  "winnerPairKey" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("dateId", "round", "position")
);
