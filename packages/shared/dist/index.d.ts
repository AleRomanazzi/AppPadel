export type Stage = "DIECISEISAVOS" | "OCTAVOS" | "CUARTOS" | "SEMIS" | "SUBCAMPEON" | "CAMPEON";
export declare const STAGE_POINTS: Record<Stage, number>;
export type DrawValidation = {
    valid: boolean;
    reason?: string;
};
export type Division = "MEN" | "WOMEN";
export declare const DIVISIONS: Division[];
export declare const DIVISION_LABELS: Record<Division, string>;
export type PlayerTier = "ABUSO" | "MORTAL";
export type PairingMode = "FECHA_LIBRE" | "ABUSO_MORTAL";
export declare const PLAYER_TIER_LABELS: Record<PlayerTier, string>;
export declare const PAIRING_MODE_LABELS: Record<PairingMode, string>;
