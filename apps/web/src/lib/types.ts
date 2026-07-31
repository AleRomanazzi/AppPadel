export type Player = { id: number; nickname: string; active?: boolean };
export type Ranking = { playerId: number; nickname: string; points: number };
export type HistoryResponse = { exists: boolean; message: string };
export type TournamentDate = {
  id: number;
  name: string;
  eventDate: string;
  status: string;
  closedAt?: string | null;
};
export type DrawPairView = {
  id: number;
  player1: number;
  player2: number;
  player1Nickname: string;
  player2Nickname: string;
};
export type BracketMatch = {
  id: number;
  round: number;
  position: number;
  pairAPlayer1: number | null;
  pairAPlayer2: number | null;
  pairBPlayer1: number | null;
  pairBPlayer2: number | null;
  score?: string | null;
  winnerPairKey?: string | null;
  pairA?: string | null;
  pairB?: string | null;
  pairAKey?: string | null;
  pairBKey?: string | null;
};
export type ZoneComputed = {
  id: number;
  name: string;
  pairs: Array<{
    key: string;
    label: string;
    player1: number;
    player2: number;
    wins: number;
    played: number;
    setDiff?: number;
    gameDiff?: number;
  }>;
  matches: Array<{
    id: number;
    pairAKey: string;
    pairBKey: string;
    pairALabel: string;
    pairBLabel: string;
    score: string | null;
    winnerPairKey: string | null;
  }>;
  qualifiers: Array<{ key: string; label: string; player1: number; player2: number; place?: number }>;
};
export type LedgerEntry = {
  id: number;
  points: number;
  reason: string;
  manual: boolean;
  createdAt: string;
  player: Player;
};
export type DateWorkspace = {
  date: TournamentDate;
  locked: boolean;
  editableUntil: string | null;
  registrations: Player[];
  seeds: Array<{ playerId: number; nickname: string }>;
  draw: { id: number; status: string; pairs: DrawPairView[] } | null;
  zones: Array<{ id: number; name: string; size: number }>;
  bracket: BracketMatch[];
  zonesComputed?: ZoneComputed[];
};
