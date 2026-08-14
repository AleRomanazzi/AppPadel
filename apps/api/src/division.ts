import type { Request, Response } from "express";
import type { Division, PairingMode, Prisma, TournamentDate, TournamentEvent } from "@prisma/client";

const DIVISION_ALIASES: Record<string, Division> = {
  MEN: "MEN",
  MAN: "MEN",
  M: "MEN",
  HOMBRES: "MEN",
  HOMBRE: "MEN",
  WOMEN: "WOMEN",
  WOMAN: "WOMEN",
  W: "WOMEN",
  MUJERES: "WOMEN",
  MUJER: "WOMEN",
  CHICAS: "WOMEN",
  CHICA: "WOMEN"
};

export function parseDivision(raw: unknown): Division | null {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toUpperCase();
  return DIVISION_ALIASES[key] ?? null;
}

export function parseDivisions(raw: unknown): Division[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Division>();
  const result: Division[] = [];
  for (const item of raw) {
    const division = parseDivision(item);
    if (division && !seen.has(division)) {
      seen.add(division);
      result.push(division);
    }
  }
  return result;
}

export function divisionFromRequest(req: Request, fallback?: Division): Division | null {
  return parseDivision(req.query.division ?? req.headers["x-division"]) ?? fallback ?? null;
}

export function requireDivisionFromRequest(
  req: Request,
  res: Response,
  fallback?: Division
): Division | null {
  const division = divisionFromRequest(req, fallback);
  if (!division) {
    res.status(400).json({ error: "Parámetro division requerido (men o women)." });
    return null;
  }
  return division;
}

export type SerializedDate = {
  id: number;
  eventId: number;
  division: Division;
  pairingMode: PairingMode;
  name: string;
  eventDate: string;
  status: string;
  closedAt: string | null;
};

export function serializeDate(date: TournamentDate & { event: TournamentEvent }): SerializedDate {
  return {
    id: date.id,
    eventId: date.eventId,
    division: date.division,
    pairingMode: date.pairingMode,
    name: date.event.name,
    eventDate: date.event.eventDate.toISOString(),
    status: date.status,
    closedAt: date.closedAt?.toISOString() ?? null
  };
}

export type SerializedEvent = {
  id: number;
  name: string;
  eventDate: string;
  dates: SerializedDate[];
};

export function serializeEvent(event: TournamentEvent & { dates: Array<TournamentDate & { event: TournamentEvent }> }): SerializedEvent {
  return {
    id: event.id,
    name: event.name,
    eventDate: event.eventDate.toISOString(),
    dates: event.dates.map(serializeDate)
  };
}

export const dateIncludeEvent = {
  event: true
} satisfies Prisma.TournamentDateInclude;

export const eventIncludeDates = {
  dates: { include: dateIncludeEvent, orderBy: [{ division: "asc" as const }] }
} satisfies Prisma.TournamentEventInclude;

export function divisionsLabel(divisions: Division[]): string {
  const hasMen = divisions.includes("MEN");
  const hasWomen = divisions.includes("WOMEN");
  if (hasMen && hasWomen) return "Hombres + Chicas";
  if (hasMen) return "Solo hombres";
  if (hasWomen) return "Solo chicas";
  return "";
}
