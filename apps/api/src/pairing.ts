type Pair = [number, number];
type DrawValidation = { valid: boolean; reason?: string };

export type PlayerTier = "ABUSO" | "MORTAL";
export type PairingMode = "FECHA_LIBRE" | "ABUSO_MORTAL";

export type PlayerWithTier = { id: number; tier: PlayerTier };

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

export const validatePairWithRules = (
  a: number,
  b: number,
  blacklist: Set<string>,
  history: Set<string>,
  options?: { forbidAbusoAbuso?: boolean; tierById?: Map<number, PlayerTier> }
): DrawValidation => {
  if (options?.forbidAbusoAbuso && options.tierById?.get(a) === "ABUSO" && options.tierById?.get(b) === "ABUSO") {
    return { valid: false, reason: "Dos abusos no pueden jugar juntos." };
  }
  return validatePair(a, b, blacklist, history);
};

const generatePairsWithPredicate = (
  players: number[],
  canPair: (a: number, b: number) => boolean
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
      if (canPair(p1, p2)) {
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

export const generatePairs = (
  players: number[],
  blacklist: Set<string>,
  history: Set<string>
): { pairs: Pair[]; conflicts: string[] } =>
  generatePairsWithPredicate(players, (a, b) => validatePair(a, b, blacklist, history).valid);

export const selectSeedPlayerIds = (attendees: PlayerWithTier[], seedCount: number): number[] => {
  const abusos = attendees.filter((player) => player.tier === "ABUSO");
  const mortales = attendees.filter((player) => player.tier !== "ABUSO");

  if (abusos.length >= seedCount) {
    return abusos.slice(0, seedCount).map((player) => player.id);
  }

  const seedIds = abusos.map((player) => player.id);
  for (const mortal of mortales) {
    if (seedIds.length >= seedCount) break;
    seedIds.push(mortal.id);
  }
  return seedIds.slice(0, seedCount);
};

export const generatePairsWithTiers = (
  players: number[],
  tierById: Map<number, PlayerTier>,
  blacklist: Set<string>,
  history: Set<string>,
  mode: PairingMode
): { pairs: Pair[]; conflicts: string[] } => {
  if (mode === "FECHA_LIBRE") {
    return generatePairs(players, blacklist, history);
  }

  const canPair = (a: number, b: number): boolean =>
    validatePairWithRules(a, b, blacklist, history, { forbidAbusoAbuso: true, tierById }).valid;

  const abusos = players.filter((id) => tierById.get(id) === "ABUSO");
  const mortales = players.filter((id) => tierById.get(id) !== "ABUSO");
  const used = new Set<number>();
  const pairs: Pair[] = [];
  const conflicts: string[] = [];

  for (const abuso of abusos) {
    if (used.has(abuso)) continue;
    let matched = false;
    for (const mortal of mortales) {
      if (used.has(mortal)) continue;
      if (!canPair(abuso, mortal)) continue;
      used.add(abuso);
      used.add(mortal);
      pairs.push(normalizePair(abuso, mortal));
      matched = true;
      break;
    }
    if (!matched) {
      conflicts.push(`No se encontró mortal disponible para abuso ${abuso}`);
    }
  }

  const remaining = players.filter((id) => !used.has(id));
  const rest = generatePairsWithPredicate(remaining, (a, b) => {
    if (tierById.get(a) === "ABUSO" && tierById.get(b) === "ABUSO") return false;
    return validatePair(a, b, blacklist, history).valid;
  });

  return {
    pairs: [...pairs, ...rest.pairs],
    conflicts: [...conflicts, ...rest.conflicts]
  };
};
