import { describe, expect, it } from "vitest";
import { generatePairs, pairKey, validatePair } from "./pairing.js";

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
});
