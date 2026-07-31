import { useMemo, useState } from "react";
import type { BracketMatch } from "../lib/types";
import { maxRoundFromMatches, roundLabel } from "../lib/bracketRounds";
import { ScoreInput, isValidSetScore } from "./ScoreInput";

type Props = {
  matches: BracketMatch[];
  editable?: boolean;
  locked?: boolean;
  scores?: Record<number, string>;
  onScoreChange?: (matchId: number, score: string) => void;
  onResultChange?: (matchId: number, winnerPairKey: string | null, score: string) => void;
};

function MatchCard({
  match,
  editable,
  locked,
  scoreValue,
  onScoreChange,
  onResultChange
}: {
  match: BracketMatch;
  editable?: boolean;
  locked?: boolean;
  scoreValue: string;
  onScoreChange?: (matchId: number, score: string) => void;
  onResultChange?: (matchId: number, winnerPairKey: string | null, score: string) => void;
}) {
  const canEdit = Boolean(editable && !locked && match.pairAKey && match.pairBKey);
  const winnerA = match.winnerPairKey && match.pairAKey === match.winnerPairKey;
  const winnerB = match.winnerPairKey && match.pairBKey === match.winnerPairKey;

  return (
    <article className="bracket-match">
      <div className={`bracket-slot ${winnerA ? "is-winner" : ""} ${winnerB ? "is-loser" : ""}`}>
        <span>{match.pairA ?? "BYE"}</span>
      </div>
      <div className={`bracket-slot ${winnerB ? "is-winner" : ""} ${winnerA ? "is-loser" : ""}`}>
        <span>{match.pairB ?? "BYE"}</span>
      </div>
      {match.score && !canEdit ? <p className="bracket-score-read">{match.score}</p> : null}
      {canEdit ? (
        <div className="bracket-edit">
          <label className="sr-only" htmlFor={`score-${match.id}`}>
            Marcador
          </label>
          <ScoreInput
            id={`score-${match.id}`}
            className="bracket-input"
            placeholder="Ej: 6-2"
            value={scoreValue}
            onChange={(next) => onScoreChange?.(match.id, next)}
            onCompleteBlur={(complete) => {
              if (match.winnerPairKey) onResultChange?.(match.id, match.winnerPairKey, complete);
            }}
          />
          <label className="sr-only" htmlFor={`winner-${match.id}`}>
            Ganador
          </label>
          <select
            id={`winner-${match.id}`}
            className="bracket-select"
            value={match.winnerPairKey ?? ""}
            onChange={(e) => {
              const winner = e.target.value ? e.target.value : null;
              if (winner && !isValidSetScore(scoreValue)) return;
              onResultChange?.(match.id, winner, scoreValue);
            }}
          >
            <option value="">Elegir ganador</option>
            <option value={match.pairAKey ?? ""}>{match.pairA}</option>
            <option value={match.pairBKey ?? ""}>{match.pairB}</option>
          </select>
        </div>
      ) : null}
    </article>
  );
}

export function TournamentBracket({
  matches,
  editable = false,
  locked = false,
  scores = {},
  onScoreChange,
  onResultChange
}: Props) {
  const maxRound = useMemo(() => maxRoundFromMatches(matches), [matches]);
  const byRound = useMemo(() => {
    const map = new Map<number, BracketMatch[]>();
    for (let r = 1; r <= maxRound; r += 1) {
      map.set(
        r,
        matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position)
      );
    }
    return map;
  }, [matches, maxRound]);

  if (matches.length === 0) {
    return <p className="muted">Todavía no hay cuadro armado.</p>;
  }

  return (
    <div className="bracket-scroll" role="region" aria-label="Cuadro eliminatorio">
      <div className="bracket-board" style={{ ["--rounds" as string]: maxRound }}>
        {Array.from({ length: maxRound }, (_, idx) => {
          const round = idx + 1;
          const roundMatches = byRound.get(round) ?? [];
          return (
            <section key={round} className="bracket-round" aria-label={roundLabel(round, maxRound)}>
              <h4 className="bracket-round-title">{roundLabel(round, maxRound)}</h4>
              <div className="bracket-round-matches">
                {roundMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    editable={editable}
                    locked={locked}
                    scoreValue={scores[match.id] ?? match.score ?? ""}
                    onScoreChange={onScoreChange}
                    onResultChange={onResultChange}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function useBracketScoreDraft(initial: Record<number, string> = {}) {
  const [scores, setScores] = useState<Record<number, string>>(initial);
  return { scores, setScores };
}
