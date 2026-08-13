import type { Division } from "@apppadel/shared";
import { DIVISION_LABELS } from "@apppadel/shared";

export type { Division };
export { DIVISION_LABELS };

export const DIVISION_STORAGE_KEY = "apppadel_division";

export function divisionQueryParam(division: Division): string {
  return division === "MEN" ? "men" : "women";
}

export function withDivisionQuery(path: string, division: Division): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}division=${divisionQueryParam(division)}`;
}

export function readStoredDivision(): Division {
  const stored = localStorage.getItem(DIVISION_STORAGE_KEY);
  return stored === "WOMEN" ? "WOMEN" : "MEN";
}

export function storeDivision(division: Division): void {
  localStorage.setItem(DIVISION_STORAGE_KEY, division);
}

export function eventTracksLabel(divisions: Division[]): string {
  const hasMen = divisions.includes("MEN");
  const hasWomen = divisions.includes("WOMEN");
  if (hasMen && hasWomen) return "Hombres + Chicas";
  if (hasMen) return "Solo hombres";
  if (hasWomen) return "Solo chicas";
  return "";
}
