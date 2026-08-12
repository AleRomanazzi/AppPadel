import { describe, expect, it } from "vitest";
import { STAGE_POINTS } from "@apppadel/shared";
import {
  getBracketTemplate,
  qualifierKey,
  resolveRound1Matchups,
  templateQualifierRefs,
  type ResolvedPair
} from "./bracketTemplates.js";
import { buildZoneSizes, qualifierCountForZoneSize } from "./zoneLayout.js";
import { computeStageAssignments, pointsForStage, stageForLostRound } from "./stages.js";
import { pairKey } from "./pairing.js";

const label = (ref: { zone: number; place: number }) => `${ref.place}ºZ${ref.zone}`;

const buildLookup = (pairCount: number): Map<string, ResolvedPair> => {
  const sizes = buildZoneSizes(pairCount);
  const lookup = new Map<string, ResolvedPair>();
  let playerId = 1;
  sizes.forEach((size, zoneIndex) => {
    const zone = zoneIndex + 1;
    const places = qualifierCountForZoneSize(size, size);
    for (let place = 1; place <= places; place += 1) {
      const p1 = playerId++;
      const p2 = playerId++;
      lookup.set(qualifierKey({ zone, place }), {
        player1: p1,
        player2: p2,
        key: pairKey(p1, p2)
      });
    }
  });
  return lookup;
};

describe("zoneLayout templates", () => {
  it("uses organizer sizes for 14–18", () => {
    expect(buildZoneSizes(14)).toEqual([3, 3, 3, 3, 2]);
    expect(buildZoneSizes(15)).toEqual([3, 3, 3, 3, 3]);
    expect(buildZoneSizes(16)).toEqual([3, 3, 3, 3, 4]);
    expect(buildZoneSizes(17)).toEqual([3, 3, 3, 2, 3, 3]);
    expect(buildZoneSizes(18)).toEqual([3, 3, 3, 3, 3, 3]);
  });
});

describe("bracket templates crossings", () => {
  it("15: 1ºZ1 bye and 3ºZ5 vs 1ºZ2", () => {
    const t = getBracketTemplate(15)!;
    expect(t).toHaveLength(8);
    expect(t[0]).toEqual([{ zone: 1, place: 1 }, null]);
    expect(t[1]).toEqual([
      { zone: 2, place: 2 },
      { zone: 4, place: 2 }
    ]);
    expect(t[7]).toEqual([
      { zone: 5, place: 3 },
      { zone: 2, place: 1 }
    ]);
  });

  it("14: 1ºZ2 bye instead of 3ºZ5", () => {
    const t = getBracketTemplate(14)!;
    expect(t[0]).toEqual([{ zone: 1, place: 1 }, null]);
    expect(t[7]).toEqual([{ zone: 2, place: 1 }, null]);
    expect(templateQualifierRefs(t).some((r) => r.zone === 5 && r.place === 3)).toBe(false);
  });

  it("16: 1ºZ1 vs 4ºZ5", () => {
    const t = getBracketTemplate(16)!;
    expect(t[0]).toEqual([
      { zone: 1, place: 1 },
      { zone: 5, place: 4 }
    ]);
  });

  it("18: two real 16vos matches", () => {
    const t = getBracketTemplate(18)!;
    expect(t).toHaveLength(16);
    expect(t[5]).toEqual([
      { zone: 1, place: 3 },
      { zone: 3, place: 3 }
    ]);
    expect(t[11]).toEqual([
      { zone: 2, place: 3 },
      { zone: 4, place: 3 }
    ]);
    const real = t.filter(([a, b]) => a && b);
    expect(real).toHaveLength(2);
  });

  it("17: only one 16vos; 3ºZ2 bye into 8vos vs 1ºZ6", () => {
    const t = getBracketTemplate(17)!;
    expect(t[5]).toEqual([
      { zone: 1, place: 3 },
      { zone: 3, place: 3 }
    ]);
    expect(t[10]).toEqual([{ zone: 6, place: 1 }, null]);
    expect(t[11]).toEqual([{ zone: 2, place: 3 }, null]);
    const real = t.filter(([a, b]) => a && b);
    expect(real).toHaveLength(1);
  });

  it("resolves all templates without missing qualifiers", () => {
    for (const pairCount of [14, 15, 16, 17, 18]) {
      const template = getBracketTemplate(pairCount)!;
      const lookup = buildLookup(pairCount);
      expect(() => resolveRound1Matchups(template, lookup)).not.toThrow();
      const resolved = resolveRound1Matchups(template, lookup);
      expect(resolved.length).toBe(template.length);
    }
  });
});

describe("stage points", () => {
  it("has DIECISEISAVOS=10 and OCTAVOS=15", () => {
    expect(STAGE_POINTS.DIECISEISAVOS).toBe(10);
    expect(STAGE_POINTS.OCTAVOS).toBe(15);
    expect(pointsForStage("DIECISEISAVOS", true)).toBe(20);
    expect(pointsForStage("OCTAVOS", true)).toBe(30);
  });

  it("maps rounds correctly with and without 16vos", () => {
    // 15 parejas: maxRound=4 → r1=octavos
    expect(stageForLostRound(1, 4)).toBe("OCTAVOS");
    expect(stageForLostRound(2, 4)).toBe("CUARTOS");
    // 18 parejas: maxRound=5 → r1=16vos
    expect(stageForLostRound(1, 5)).toBe("DIECISEISAVOS");
    expect(stageForLostRound(2, 5)).toBe("OCTAVOS");
  });
});

type SimMatch = {
  round: number;
  position: number;
  pairAPlayer1: number | null;
  pairAPlayer2: number | null;
  pairBPlayer1: number | null;
  pairBPlayer2: number | null;
  winnerPairKey: string | null;
};

/** Simula cuadro completo: en partidos reales siempre gana pairA. */
const simulateBracket = (pairCount: number): { assignments: Map<number, string>; counts: Record<string, number> } => {
  const template = getBracketTemplate(pairCount)!;
  const lookup = buildLookup(pairCount);
  const r1 = resolveRound1Matchups(template, lookup);

  const matches: SimMatch[] = r1.map((m, index) => ({
    round: 1,
    position: index + 1,
    pairAPlayer1: m[0]?.player1 ?? null,
    pairAPlayer2: m[0]?.player2 ?? null,
    pairBPlayer1: m[1]?.player1 ?? null,
    pairBPlayer2: m[1]?.player2 ?? null,
    winnerPairKey: null
  }));

  let count = r1.length;
  let round = 2;
  while (count > 1) {
    for (let i = 0; i < count / 2; i += 1) {
      matches.push({
        round,
        position: i + 1,
        pairAPlayer1: null,
        pairAPlayer2: null,
        pairBPlayer1: null,
        pairBPlayer2: null,
        winnerPairKey: null
      });
    }
    count /= 2;
    round += 1;
  }

  const byRoundPos = (r: number, p: number) => matches.find((m) => m.round === r && m.position === p)!;

  const advance = (r: number, p: number, p1: number, p2: number) => {
    const next = byRoundPos(r + 1, Math.ceil(p / 2));
    if (!next) return;
    if (p % 2 === 1) {
      next.pairAPlayer1 = p1;
      next.pairAPlayer2 = p2;
    } else {
      next.pairBPlayer1 = p1;
      next.pairBPlayer2 = p2;
    }
  };

  const decide = (match: SimMatch) => {
    const aOk = match.pairAPlayer1 != null && match.pairAPlayer2 != null;
    const bOk = match.pairBPlayer1 != null && match.pairBPlayer2 != null;
    if (aOk && !bOk) {
      match.winnerPairKey = pairKey(match.pairAPlayer1!, match.pairAPlayer2!);
      advance(match.round, match.position, match.pairAPlayer1!, match.pairAPlayer2!);
      return;
    }
    if (!aOk && bOk) {
      match.winnerPairKey = pairKey(match.pairBPlayer1!, match.pairBPlayer2!);
      advance(match.round, match.position, match.pairBPlayer1!, match.pairBPlayer2!);
      return;
    }
    if (aOk && bOk) {
      // Gana siempre A (determinista)
      match.winnerPairKey = pairKey(match.pairAPlayer1!, match.pairAPlayer2!);
      advance(match.round, match.position, match.pairAPlayer1!, match.pairAPlayer2!);
    }
  };

  const maxRound = Math.max(...matches.map((m) => m.round));
  for (let r = 1; r <= maxRound; r += 1) {
    matches.filter((m) => m.round === r).forEach(decide);
  }

  const assignments = computeStageAssignments(matches, pairKey);
  const counts: Record<string, number> = {};
  for (const stage of assignments.values()) {
    counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return { assignments, counts };
};

describe("simulated scoreboard", () => {
  it("15 pairs: 14 losers in octavos path, no 16vos points", () => {
    const { counts } = simulateBracket(15);
    // 15 pairs * 2 players = 30 players in zones, but only qualifiers enter bracket.
    // 15 qualifiers (5*3). Finalists: 2 campeon + 2 sub = 4 players with high stages.
    // Remaining qualifier players get OCTAVOS/CUARTOS/SEMIS.
    expect(counts.DIECISEISAVOS ?? 0).toBe(0);
    expect(counts.CAMPEON).toBe(2);
    expect(counts.SUBCAMPEON).toBe(2);
    expect(counts.OCTAVOS).toBeGreaterThan(0);
    const totalPlayers = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(totalPlayers).toBe(30); // all 15 pairs * 2
  });

  it("18 pairs: losers of the two 16vos get DIECISEISAVOS", () => {
    const { counts } = simulateBracket(18);
    expect(counts.DIECISEISAVOS).toBe(4); // 2 matches * 2 players
    expect(counts.CAMPEON).toBe(2);
    expect(counts.SUBCAMPEON).toBe(2);
    expect(STAGE_POINTS.DIECISEISAVOS).toBe(10);
  });

  it("17 pairs: only one 16vos → 2 players with 10 pts stage", () => {
    const { counts } = simulateBracket(17);
    expect(counts.DIECISEISAVOS).toBe(2);
  });

  it("14 pairs: two byes in first round slots (Z1#1 and Z2#1)", () => {
    const template = getBracketTemplate(14)!;
    const byes = template.filter(([a, b]) => (a && !b) || (!a && b));
    expect(byes.length).toBe(2);
    expect(label(template[0][0]!)).toBe("1ºZ1");
    expect(label(template[7][0]!)).toBe("1ºZ2");
  });
});
