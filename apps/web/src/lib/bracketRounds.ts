/** Nombres de ronda según distancia a la final. */
export function roundLabel(round: number, maxRound: number): string {
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return "Final";
  if (fromFinal === 1) return "Semifinal";
  if (fromFinal === 2) return "Cuartos de final";
  if (fromFinal === 3) return "Octavos de final";
  if (fromFinal === 4) return "Dieciseisavos";
  return `Ronda ${round}`;
}

export function maxRoundFromMatches(matches: Array<{ round: number }>): number {
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => m.round));
}
