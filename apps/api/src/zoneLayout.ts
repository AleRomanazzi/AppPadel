/**
 * Tamaños de zona por cantidad de parejas (plantillas del organizador).
 * Z1..Zn en orden A, B, C...
 */
export const ZONE_SIZE_TEMPLATES: Record<number, number[]> = {
  14: [3, 3, 3, 3, 2],
  15: [3, 3, 3, 3, 3],
  16: [3, 3, 3, 3, 4],
  17: [3, 3, 3, 2, 3, 3],
  18: [3, 3, 3, 3, 3, 3]
};

/** Fallback histórico: máx 3 por zona; resto 1 o 2. */
export const buildZoneSizesFallback = (pairCount: number): number[] => {
  if (pairCount <= 0) return [];
  const zonesOf3 = Math.floor(pairCount / 3);
  const remainder = pairCount % 3;
  const sizes = Array.from({ length: zonesOf3 }, () => 3);
  if (remainder > 0) sizes.push(remainder);
  return sizes;
};

export const buildZoneSizes = (pairCount: number): number[] => {
  return ZONE_SIZE_TEMPLATES[pairCount] ?? buildZoneSizesFallback(pairCount);
};

/** Cuántos clasifican por tamaño de zona (Z5 de 4 → también el 4º). */
export const qualifierCountForZoneSize = (size: number, pairCountInZone: number): number => {
  const cap = size >= 4 ? 4 : 3;
  return Math.min(cap, size, pairCountInZone);
};
