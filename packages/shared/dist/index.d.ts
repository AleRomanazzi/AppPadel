export type Stage = "OCTAVOS" | "CUARTOS" | "SEMIS" | "SUBCAMPEON" | "CAMPEON";
export declare const STAGE_POINTS: Record<Stage, number>;
export type DrawValidation = {
    valid: boolean;
    reason?: string;
};
