import type { Division, PairingMode, PlayerTier } from "@apppadel/shared";
import { DIVISION_LABELS, PAIRING_MODE_LABELS, PLAYER_TIER_LABELS } from "@apppadel/shared";
import type { TournamentDate, TournamentEvent } from "./types";

export type { Division, PairingMode, PlayerTier };
export { DIVISION_LABELS, PAIRING_MODE_LABELS, PLAYER_TIER_LABELS };

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

export function formatDateStatus(status: string): string {
  switch (status) {
    case "OPEN":
      return "Abierta";
    case "CLOSED":
      return "Cerrada";
    case "DRAFT":
      return "Borrador";
    default:
      return status;
  }
}

/** Encabezado de grupo en el desplegable admin: "Fecha 5 · 15/03/2026" */
export function formatEventGroupLabel(
  event: Pick<TournamentEvent, "name" | "eventDate">,
  formatEventDate: (value: string) => string
): string {
  return `${event.name} · ${formatEventDate(event.eventDate)}`;
}

/** Opción dentro del grupo: "Hombres · Abierta" */
export function formatDateTrackOptionLabel(date: Pick<TournamentDate, "division" | "status">): string {
  return `${DIVISION_LABELS[date.division]} · ${formatDateStatus(date.status)}`;
}

/** Etiqueta plana (vista pública): "Fecha 5 · 15/03/2026 · Abierta" */
export function formatDateSelectLabel(
  date: Pick<TournamentDate, "name" | "eventDate" | "status">,
  formatEventDate: (value: string) => string
): string {
  return `${date.name} · ${formatEventDate(date.eventDate)} · ${formatDateStatus(date.status)}`;
}

export function findDateInEvents(events: TournamentEvent[], dateId: number): TournamentDate | undefined {
  for (const event of events) {
    const match = event.dates.find((date) => date.id === dateId);
    if (match) return match;
  }
  return undefined;
}
