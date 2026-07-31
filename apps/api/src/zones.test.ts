import { describe, expect, it } from "vitest";
import { seedRankByZoneIndex, zoneIndexBySeedRank } from "./seedPlacement.js";

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

describe("seedPlacement opposite ends", () => {
  it("places #1 in A and #2 in D for 4 zones (12 pairs)", () => {
    // zone index → seed rank (0-based)
    expect(seedRankByZoneIndex(4)).toEqual([0, 2, 3, 1]);
    // seed rank → zone: #1→A(0), #2→D(3), #3→B(1), #4→C(2)
    expect(zoneIndexBySeedRank(4)).toEqual([0, 3, 1, 2]);
  });

  it("places #1 in A and #2 in last zone for 2 and 3 zones", () => {
    expect(seedRankByZoneIndex(2)).toEqual([0, 1]);
    expect(seedRankByZoneIndex(3)).toEqual([0, 2, 1]);
  });
});
