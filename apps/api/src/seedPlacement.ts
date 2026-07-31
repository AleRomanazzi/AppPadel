/**
 * Asigna cabezas a zonas con extremos opuestos (estilo cuadro):
 * #1 → Zona A, #2 → última zona, #3 → B, #4 → penúltima, etc.
 *
 * Para 4 zonas (12 parejas): A=#1, B=#3, C=#4, D=#2.
 */
export const seedRankByZoneIndex = (zoneCount: number): number[] => {
  const ranks = Array.from({ length: zoneCount }, () => -1);
  let lo = 0;
  let hi = zoneCount - 1;
  for (let seedRank = 0; seedRank < zoneCount; seedRank += 1) {
    if (seedRank % 2 === 0) {
      ranks[lo] = seedRank;
      lo += 1;
    } else {
      ranks[hi] = seedRank;
      hi -= 1;
    }
  }
  return ranks;
};

/** Índice de zona (0=A) para cada seed rank (0=#1). */
export const zoneIndexBySeedRank = (zoneCount: number): number[] => {
  const byZone = seedRankByZoneIndex(zoneCount);
  const byRank = Array.from({ length: zoneCount }, () => -1);
  byZone.forEach((rank, zoneIndex) => {
    if (rank >= 0) byRank[rank] = zoneIndex;
  });
  return byRank;
};
