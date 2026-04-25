type Pair = [number, number];
type DrawValidation = { valid: boolean; reason?: string };

export const normalizePair = (a: number, b: number): Pair => (a < b ? [a, b] : [b, a]);

export const pairKey = (a: number, b: number): string => {
  const [x, y] = normalizePair(a, b);
  return `${x}-${y}`;
};

export const validatePair = (
  a: number,
  b: number,
  blacklist: Set<string>,
  history: Set<string>
): DrawValidation => {
  const key = pairKey(a, b);
  if (blacklist.has(key)) {
    return { valid: false, reason: "La pareja está en blacklist" };
  }
  if (history.has(key)) {
    return { valid: false, reason: "La pareja ya jugó junta" };
  }
  return { valid: true };
};

export const generatePairs = (
  players: number[],
  blacklist: Set<string>,
  history: Set<string>
): { pairs: Pair[]; conflicts: string[] } => {
  const used = new Set<number>();
  const pairs: Pair[] = [];
  const conflicts: string[] = [];

  for (let i = 0; i < players.length; i += 1) {
    const p1 = players[i];
    if (used.has(p1)) continue;
    let chosen: number | null = null;

    for (let j = i + 1; j < players.length; j += 1) {
      const p2 = players[j];
      if (used.has(p2)) continue;
      if (validatePair(p1, p2, blacklist, history).valid) {
        chosen = p2;
        break;
      }
    }

    if (chosen === null) {
      conflicts.push(`No se pudo asignar pareja válida a jugador ${p1}`);
      continue;
    }

    used.add(p1);
    used.add(chosen);
    pairs.push(normalizePair(p1, chosen));
  }

  return { pairs, conflicts };
};
