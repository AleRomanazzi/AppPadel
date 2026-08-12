/** Referencia a un clasificado: zona 1-based (Z1=A), place 1-based. */
export type QualifierRef = { zone: number; place: number };

export type BracketSide = QualifierRef | null;

/** Un partido de la primera ronda del cuadro (bye si un lado es null). */
export type Round1Matchup = [BracketSide, BracketSide];

const q = (zone: number, place: number): QualifierRef => ({ zone, place });

/** Plantilla 15: 5 zonas × 3. 1º Z1 con bye a 4tos. */
const TEMPLATE_15: Round1Matchup[] = [
  [q(1, 1), null],
  [q(2, 2), q(4, 2)],
  [q(3, 1), q(1, 3)],
  [q(4, 3), q(5, 1)],
  [q(3, 2), q(5, 2)],
  [q(2, 3), q(4, 1)],
  [q(1, 2), q(3, 3)],
  [q(5, 3), q(2, 1)]
];

/** Plantilla 14: Z5 con 2 → 1º Z2 bye (no hay 3º Z5). */
const TEMPLATE_14: Round1Matchup[] = [
  [q(1, 1), null],
  [q(2, 2), q(4, 2)],
  [q(3, 1), q(1, 3)],
  [q(4, 3), q(5, 1)],
  [q(3, 2), q(5, 2)],
  [q(2, 3), q(4, 1)],
  [q(1, 2), q(3, 3)],
  [q(2, 1), null]
];

/** Plantilla 16: Z5 con 4 → 1º Z1 vs 4º Z5 en 8vos. */
const TEMPLATE_16: Round1Matchup[] = [
  [q(1, 1), q(5, 4)],
  [q(2, 2), q(4, 2)],
  [q(3, 1), q(1, 3)],
  [q(4, 3), q(5, 1)],
  [q(3, 2), q(5, 2)],
  [q(2, 3), q(4, 1)],
  [q(1, 2), q(3, 3)],
  [q(5, 3), q(2, 1)]
];

/**
 * Plantilla 18: 6×3 con 2×16vos embebidos en ronda 1 (16 slots).
 * Solo 2 partidos reales en 16vos; el resto son byes hacia 8vos.
 */
const TEMPLATE_18: Round1Matchup[] = [
  // → 8vos: 1ºZ1 vs 3ºZ5
  [q(1, 1), null],
  [q(5, 3), null],
  // → 8vos: 1ºZ3 vs 2ºZ6
  [q(3, 1), null],
  [q(6, 2), null],
  // → 8vos: 1ºZ5 vs ganador(3ºZ1 vs 3ºZ3)
  [q(5, 1), null],
  [q(1, 3), q(3, 3)],
  // → 8vos: 2ºZ2 vs 2ºZ4
  [q(2, 2), null],
  [q(4, 2), null],
  // → 8vos: 2ºZ3 vs 2ºZ5
  [q(3, 2), null],
  [q(5, 2), null],
  // → 8vos: 1ºZ6 vs ganador(3ºZ2 vs 3ºZ4)
  [q(6, 1), null],
  [q(2, 3), q(4, 3)],
  // → 8vos: 1ºZ4 vs 3ºZ6
  [q(4, 1), null],
  [q(6, 3), null],
  // → 8vos: 2ºZ1 vs 1ºZ2
  [q(1, 2), null],
  [q(2, 1), null]
];

/**
 * Plantilla 17: Z4 con 2 → un solo 16vos (3ºZ1 vs 3ºZ3).
 * 3º Z2 entra directo a 8vos vs 1º Z6.
 */
const TEMPLATE_17: Round1Matchup[] = TEMPLATE_18.map((matchup, index) => {
  // Slot índice 11 (0-based): era 3ºZ2 vs 3ºZ4 → solo 3ºZ2 bye
  if (index === 11) return [q(2, 3), null];
  return matchup;
});

const TEMPLATES: Record<number, Round1Matchup[]> = {
  14: TEMPLATE_14,
  15: TEMPLATE_15,
  16: TEMPLATE_16,
  17: TEMPLATE_17,
  18: TEMPLATE_18
};

export const hasBracketTemplate = (pairCount: number): boolean => pairCount in TEMPLATES;

export const getBracketTemplate = (pairCount: number): Round1Matchup[] | null => {
  return TEMPLATES[pairCount] ?? null;
};

export const qualifierKey = (ref: QualifierRef): string => `${ref.zone}:${ref.place}`;

export type ResolvedPair = { player1: number; player2: number; key: string };

export const resolveRound1Matchups = (
  template: Round1Matchup[],
  lookup: Map<string, ResolvedPair>
): Array<[ResolvedPair | null, ResolvedPair | null]> => {
  return template.map(([sideA, sideB]) => {
    const resolve = (side: BracketSide): ResolvedPair | null => {
      if (!side) return null;
      const found = lookup.get(qualifierKey(side));
      if (!found) {
        throw new Error(`Falta clasificado ${qualifierKey(side)} (Z${side.zone} lugar ${side.place}).`);
      }
      return found;
    };
    return [resolve(sideA), resolve(sideB)];
  });
};

/** Lista refs usadas en la plantilla (para validar). */
export const templateQualifierRefs = (template: Round1Matchup[]): QualifierRef[] => {
  const refs: QualifierRef[] = [];
  for (const [a, b] of template) {
    if (a) refs.push(a);
    if (b) refs.push(b);
  }
  return refs;
};
