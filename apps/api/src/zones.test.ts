import { describe, expect, it } from "vitest";
import { seedRankByZoneIndex, zoneIndexBySeedRank } from "./seedPlacement.js";
import { buildZoneSizes, buildZoneSizesFallback } from "./zoneLayout.js";

describe("buildZoneSizes templates + fallback", () => {
  it("uses templates for 14-18", () => {
    expect(buildZoneSizes(15)).toEqual([3, 3, 3, 3, 3]);
    expect(buildZoneSizes(16)).toEqual([3, 3, 3, 3, 4]);
  });

  it("fallback never creates a zone larger than 3", () => {
    for (let n = 1; n <= 13; n += 1) {
      const sizes = buildZoneSizesFallback(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      if (sizes.length) expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
    }
  });
});

describe("seedPlacement opposite ends", () => {
  it("places #1 in A and #2 in D for 4 zones (12 pairs)", () => {
    expect(seedRankByZoneIndex(4)).toEqual([0, 2, 3, 1]);
    expect(zoneIndexBySeedRank(4)).toEqual([0, 3, 1, 2]);
  });

  it("places #1 in A and #2 in last zone for 2 and 3 zones", () => {
    expect(seedRankByZoneIndex(2)).toEqual([0, 1]);
    expect(seedRankByZoneIndex(3)).toEqual([0, 2, 1]);
  });
});
