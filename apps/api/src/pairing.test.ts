import { describe, expect, it } from "vitest";
import {
  generatePairs,
  generatePairsWithTiers,
  pairKey,
  selectSeedPlayerIds,
  validatePair,
  validatePairWithRules
} from "./pairing.js";

describe("pairing engine", () => {
  it("valida blacklist e historial", () => {
    const blacklist = new Set([pairKey(1, 2)]);
    const history = new Set([pairKey(3, 4)]);
    expect(validatePair(1, 2, blacklist, history).valid).toBe(false);
    expect(validatePair(3, 4, blacklist, history).valid).toBe(false);
    expect(validatePair(1, 4, blacklist, history).valid).toBe(true);
  });

  it("genera parejas evitando restricciones", () => {
    const blacklist = new Set([pairKey(1, 2), pairKey(3, 4)]);
    const history = new Set([pairKey(1, 3)]);
    const output = generatePairs([1, 2, 3, 4], blacklist, history);
    expect(output.conflicts.length).toBe(0);
    expect(output.pairs.length).toBe(2);
  });

  it("impide parejas abuso-abuso", () => {
    const tierById = new Map([
      [1, "ABUSO" as const],
      [2, "ABUSO" as const]
    ]);
    const result = validatePairWithRules(1, 2, new Set(), new Set(), {
      forbidAbusoAbuso: true,
      tierById
    });
    expect(result.valid).toBe(false);
  });

  it("elige abusos como cabezas de zona", () => {
    const attendees = [
      { id: 1, tier: "ABUSO" as const },
      { id: 2, tier: "ABUSO" as const },
      { id: 3, tier: "MORTAL" as const },
      { id: 4, tier: "MORTAL" as const }
    ];
    expect(selectSeedPlayerIds(attendees, 2)).toEqual([1, 2]);
  });

  it("prioriza abuso + mortal en modo abuso_mortal", () => {
    const tierById = new Map([
      [1, "ABUSO" as const],
      [2, "ABUSO" as const],
      [3, "MORTAL" as const],
      [4, "MORTAL" as const]
    ]);
    const output = generatePairsWithTiers([1, 2, 3, 4], tierById, new Set(), new Set(), "ABUSO_MORTAL");
    expect(output.conflicts.length).toBe(0);
    expect(output.pairs).toContainEqual([1, 3]);
    expect(output.pairs).toContainEqual([2, 4]);
  });

  it("permite mortal + mortal si faltan abusos disponibles", () => {
    const tierById = new Map([
      [1, "ABUSO" as const],
      [2, "MORTAL" as const],
      [3, "MORTAL" as const],
      [4, "MORTAL" as const]
    ]);
    const output = generatePairsWithTiers([1, 2, 3, 4], tierById, new Set(), new Set(), "ABUSO_MORTAL");
    expect(output.conflicts.length).toBe(0);
    expect(output.pairs.length).toBe(2);
    const mortalPair = output.pairs.find(([a, b]) => a !== 1 && b !== 1);
    expect(mortalPair).toBeDefined();
  });

  it("fecha libre ignora tiers", () => {
    const tierById = new Map([
      [1, "ABUSO" as const],
      [2, "ABUSO" as const],
      [3, "MORTAL" as const],
      [4, "MORTAL" as const]
    ]);
    const output = generatePairsWithTiers([1, 2, 3, 4], tierById, new Set(), new Set(), "FECHA_LIBRE");
    expect(output.conflicts.length).toBe(0);
    expect(output.pairs.length).toBe(2);
  });
});
