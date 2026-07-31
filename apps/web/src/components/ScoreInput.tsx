import type { ChangeEvent } from "react";

/** Copia liviana de la validación de marcador (un set) para el front. */

const SCORE_RE = /^([0-7])-([0-7])$/;

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

export const formatScoreTyping = (previous: string, nextRaw: string): string => {
  if (nextRaw === "") return "";

  if (previous && nextRaw.length < previous.length) {
    const only = nextRaw.replace(/[^\d-]/g, "");
    if (only === "") return "";
    if (/^[0-7]$/.test(only)) return `${only}-`;
    if (/^[0-7]-$/.test(only)) return only;
    if (SCORE_RE.test(only) && isValidSetScore(only)) return only;
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
  if (!isValidSetScore(candidate)) return `${first}-`;
  return candidate;
};

type ScoreInputProps = {
  id?: string;
  value: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCompleteBlur?: (value: string) => void;
};

export function ScoreInput({
  id,
  value,
  disabled,
  className,
  placeholder = "Ej: 6-2",
  onChange,
  onCompleteBlur
}: ScoreInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = formatScoreTyping(value, event.target.value);
    onChange(next);
  };

  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onChange={handleChange}
      onBlur={() => {
        if (isValidSetScore(value)) onCompleteBlur?.(value);
      }}
      aria-invalid={value !== "" && value !== "-" && !value.endsWith("-") && !isValidSetScore(value)}
    />
  );
}
