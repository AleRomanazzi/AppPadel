import { describe, expect, it } from "vitest";

/** Mirror of buildZoneSizes logic for unit testing without booting Express. */
const buildZoneSizes = (pairCount: number): number[] => {
  if (pairCount <= 0) return [];
  const zonesOf3 = Math.floor(pairCount / 3);
  const remainder = pairCount % 3;
  const sizes = Array.from({ length: zonesOf3 }, () => 3);
  if (remainder > 0) sizes.push(remainder);
  return sizes;
};

describe("buildZoneSizes max 3", () => {
  it("uses only zones of 3 when multiple of 3", () => {
    expect(buildZoneSizes(6)).toEqual([3, 3]);
    expect(buildZoneSizes(9)).toEqual([3, 3, 3]);
  });

  it("adds a zone of 2 when remainder is 2", () => {
    expect(buildZoneSizes(5)).toEqual([3, 2]);
    expect(buildZoneSizes(8)).toEqual([3, 3, 2]);
  });

  it("adds a zone of 1 when remainder is 1", () => {
    expect(buildZoneSizes(4)).toEqual([3, 1]);
    expect(buildZoneSizes(7)).toEqual([3, 3, 1]);
  });

  it("never creates a zone larger than 3", () => {
    for (let n = 1; n <= 24; n += 1) {
      const sizes = buildZoneSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
    }
  });
});
