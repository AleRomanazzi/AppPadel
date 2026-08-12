import type { Stage } from "@apppadel/shared";
import { STAGE_POINTS } from "@apppadel/shared";

export type { Stage };
export { STAGE_POINTS };

export const STAGE_RANK: Record<Stage, number> = {
  DIECISEISAVOS: 1,
  OCTAVOS: 2,
  CUARTOS: 3,
  SEMIS: 4,
  SUBCAMPEON: 5,
  CAMPEON: 6
};

export const stageForLostRound = (round: number, maxRound: number): Stage => {
  const fromFinal = maxRound - round;
  if (fromFinal <= 1) return "SEMIS";
  if (fromFinal === 2) return "CUARTOS";
  if (fromFinal === 3) return "OCTAVOS";
  return "DIECISEISAVOS";
};

export const computeStageAssignments = (
  matches: Array<{
    round: number;
    pairAPlayer1: number | null;
    pairAPlayer2: number | null;
    pairBPlayer1: number | null;
    pairBPlayer2: number | null;
    winnerPairKey: string | null;
  }>,
  pairKeyFn: (p1: number, p2: number) => string
): Map<number, Stage> => {
  const assignments = new Map<number, Stage>();
  if (matches.length === 0) return assignments;

  const maxRound = Math.max(...matches.map((m) => m.round));
  const bracketPairKey = (p1: number | null, p2: number | null): string | null => {
    if (p1 == null || p2 == null) return null;
    return pairKeyFn(p1, p2);
  };

  const setStage = (playerId: number | null, stage: Stage) => {
    if (playerId == null) return;
    const current = assignments.get(playerId);
    if (!current || STAGE_RANK[stage] > STAGE_RANK[current]) {
      assignments.set(playerId, stage);
    }
  };

  for (const match of matches) {
    if (!match.winnerPairKey) continue;
    const keyA = bracketPairKey(match.pairAPlayer1, match.pairAPlayer2);
    const keyB = bracketPairKey(match.pairBPlayer1, match.pairBPlayer2);
    const winnerIsA = match.winnerPairKey === keyA;
    const loserPlayers = winnerIsA
      ? [match.pairBPlayer1, match.pairBPlayer2]
      : [match.pairAPlayer1, match.pairAPlayer2];
    const winnerPlayers = winnerIsA
      ? [match.pairAPlayer1, match.pairAPlayer2]
      : [match.pairBPlayer1, match.pairBPlayer2];

    // BYE: no hay perdedor real
    const hasBothSides = keyA != null && keyB != null;
    if (match.round === maxRound) {
      winnerPlayers.forEach((id) => setStage(id, "CAMPEON"));
      if (hasBothSides) loserPlayers.forEach((id) => setStage(id, "SUBCAMPEON"));
    } else if (hasBothSides) {
      const stage = stageForLostRound(match.round, maxRound);
      loserPlayers.forEach((id) => setStage(id, stage));
    }
  }

  return assignments;
};

export const pointsForStage = (stage: Stage, doublePoints: boolean): number => {
  return STAGE_POINTS[stage] * (doublePoints ? 2 : 1);
};
