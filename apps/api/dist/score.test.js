import { describe, expect, it } from "vitest";
import { formatScoreTyping, isValidSetScore, parseScoreForPairA, scoreDiffForPair } from "./score.js";
describe("single-set score validation", () => {
    it("accepts normal and tie-break scores", () => {
        expect(isValidSetScore("6-2")).toBe(true);
        expect(isValidSetScore("7-5")).toBe(true);
        expect(isValidSetScore("7-6")).toBe(true);
        expect(isValidSetScore("5-7")).toBe(true);
    });
    it("rejects invalid shapes and 7 with wrong partner", () => {
        expect(isValidSetScore("6-4 6-3")).toBe(false);
        expect(isValidSetScore("63-4")).toBe(false);
        expect(isValidSetScore("6-77")).toBe(false);
        expect(isValidSetScore("7-4")).toBe(false);
        expect(isValidSetScore("7-0")).toBe(false);
        expect(isValidSetScore("8-6")).toBe(false);
    });
});
describe("score parsing", () => {
    it("parses a single set for pair A", () => {
        expect(parseScoreForPairA("6-2")).toEqual({ setDiff: 1, gameDiff: 4 });
    });
    it("inverts for pair B", () => {
        expect(scoreDiffForPair("6-2", false)).toEqual({ setDiff: -1, gameDiff: -4 });
    });
});
describe("formatScoreTyping", () => {
    it("inserts hyphen after first digit", () => {
        expect(formatScoreTyping("", "6")).toBe("6-");
    });
    it("completes a valid set", () => {
        expect(formatScoreTyping("6-", "6-2")).toBe("6-2");
    });
    it("blocks invalid second digit for 7-", () => {
        expect(formatScoreTyping("7-", "7-4")).toBe("7-");
        expect(formatScoreTyping("7-", "7-6")).toBe("7-6");
    });
    it("blocks multi-digit sides and normalizes to one digit each", () => {
        expect(formatScoreTyping("", "63")).toBe("6-3");
        expect(formatScoreTyping("6-2", "6-27")).toBe("6-2");
        expect(formatScoreTyping("", "77")).toBe("7-");
    });
});
