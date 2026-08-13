export type Stage =
  | "DIECISEISAVOS"
  | "OCTAVOS"
  | "CUARTOS"
  | "SEMIS"
  | "SUBCAMPEON"
  | "CAMPEON";

export const STAGE_POINTS: Record<Stage, number> = {
  DIECISEISAVOS: 10,
  OCTAVOS: 15,
  CUARTOS: 25,
  SEMIS: 50,
  SUBCAMPEON: 75,
  CAMPEON: 100
};

export type DrawValidation = {
  valid: boolean;
  reason?: string;
};

export type Division = "MEN" | "WOMEN";

export const DIVISIONS: Division[] = ["MEN", "WOMEN"];

export const DIVISION_LABELS: Record<Division, string> = {
  MEN: "Hombres",
  WOMEN: "Chicas"
};
