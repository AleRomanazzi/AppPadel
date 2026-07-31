/** Marcador de un solo set, desde la perspectiva de pairA: "6-2", "7-6", etc. */

export type SetDiff = { setDiff: number; gameDiff: number };

const SCORE_RE = /^([0-7])-([0-7])$/;

/** Si hay un 7 (tie-break), el otro debe ser 5 o 6. */
export const isValidSetScore = (score: string | null | undefined): boolean => {
  if (!score?.trim()) return false;
  const match = SCORE_RE.exec(score.trim());
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 7 && b !== 5 && b !== 6) return false;
  if (b === 7 && a !== 5 && a !== 6) return false;
  return true;
};

export const parseScoreForPairA = (score: string | null | undefined): SetDiff => {
  if (!score?.trim() || score.trim().toUpperCase() === "BYE") {
    return { setDiff: 0, gameDiff: 0 };
  }
  if (!isValidSetScore(score)) return { setDiff: 0, gameDiff: 0 };
  const match = SCORE_RE.exec(score.trim())!;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const gameDiff = a - b;
  const setDiff = a > b ? 1 : a < b ? -1 : 0;
  return { setDiff, gameDiff };
};

export const scoreDiffForPair = (
  score: string | null | undefined,
  isPairA: boolean
): SetDiff => {
  const base = parseScoreForPairA(score);
  if (isPairA) return base;
  return { setDiff: -base.setDiff, gameDiff: -base.gameDiff };
};

/**
 * Formatea tipeo de marcador:
 * - un dígito 0-7 + guión automático
 * - segundo dígito 0-7
 * - si hay un 7, el otro solo puede ser 5 o 6
 * - evita "63-4", "6-77", etc.
 */
export const formatScoreTyping = (previous: string, nextRaw: string): string => {
  if (nextRaw === "") return "";

  // Permitir borrar hasta quedar en "6-" o "6"
  if (previous && nextRaw.length < previous.length) {
    if (nextRaw === "-" || nextRaw.endsWith("-") && nextRaw.length === 2) {
      const d = nextRaw.replace(/\D/g, "");
      return d ? `${d}-` : "";
    }
    const only = nextRaw.replace(/[^\d-]/g, "");
    if (/^[0-7]$/.test(only)) return `${only}-`;
    if (/^[0-7]-$/.test(only)) return only;
    if (only === "") return "";
    if (SCORE_RE.test(only) && isValidSetScore(only)) return only;
    // Si borró el segundo dígito: "6-"
    const m = /^([0-7])-?/.exec(only);
    if (m) return `${m[1]}-`;
    return "";
  }

  const digits = nextRaw.replace(/\D/g, "").slice(0, 2);
  if (digits.length === 0) return "";

  const first = Number(digits[0]);
  if (first > 7) return previous;

  if (digits.length === 1) return `${first}-`;

  const second = Number(digits[1]);
  if (second > 7) return previous.endsWith("-") ? previous : `${first}-`;

  const candidate = `${first}-${second}`;
  if (!isValidSetScore(candidate)) {
    // Mantener "7-" si todavía no eligió 5/6
    return `${first}-`;
  }
  return candidate;
};
