export type Stage = "OCTAVOS" | "CUARTOS" | "SEMIS" | "SUBCAMPEON" | "CAMPEON";

export const STAGE_POINTS: Record<Stage, number> = {
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
