import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ADMIN_TOKEN_KEY = "apppadel_admin_token";

type Player = { id: number; nickname: string };
type Ranking = { playerId: number; nickname: string; points: number };
type HistoryResponse = { exists: boolean; message: string };
type TournamentDate = { id: number; name: string; eventDate: string; status: string };
type DrawPairView = { id: number; player1: number; player2: number; player1Nickname: string; player2Nickname: string };
type BracketMatch = {
  id: number;
  round: number;
  position: number;
  pairAPlayer1: number | null;
  pairAPlayer2: number | null;
  pairBPlayer1: number | null;
  pairBPlayer2: number | null;
  pairA?: string;
  pairB?: string;
};
type ZoneComputed = {
  id: number;
  name: string;
  pairs: Array<{ key: string; label: string; player1: number; player2: number; wins: number; played: number }>;
  matches: Array<{
    id: number;
    pairAKey: string;
    pairBKey: string;
    pairALabel: string;
    pairBLabel: string;
    score: string | null;
    winnerPairKey: string | null;
  }>;
  qualifiers: Array<{ key: string; label: string; player1: number; player2: number }>;
};
type LedgerEntry = {
  id: number;
  points: number;
  reason: string;
  manual: boolean;
  createdAt: string;
  player: Player;
};
type DateWorkspace = {
  date: TournamentDate;
  registrations: Player[];
  seeds: Array<{ playerId: number; nickname: string }>;
  draw: { id: number; status: string; pairs: DrawPairView[] } | null;
  zones: Array<{ id: number; name: string; size: number }>;
  bracket: BracketMatch[];
  zonesComputed?: ZoneComputed[];
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `API error ${response.status}`);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

function App() {
  const navigate = useNavigate();
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem(ADMIN_TOKEN_KEY));
  const [loginUser, setLoginUser] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [ranking, setRanking] = useState<Ranking[]>([]);
  const [blacklist, setBlacklist] = useState<Player[]>([]);
  const [selectedBlacklistIds, setSelectedBlacklistIds] = useState<number[]>([]);
  const [blacklistCandidate, setBlacklistCandidate] = useState("");
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState("");
  const [historyA, setHistoryA] = useState("");
  const [historyB, setHistoryB] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyLookupPlayer, setHistoryLookupPlayer] = useState("");
  const [historyLookupResult, setHistoryLookupResult] = useState<Player[]>([]);
  const [historyLookupMessage, setHistoryLookupMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const [dates, setDates] = useState<TournamentDate[]>([]);
  const [newDateName, setNewDateName] = useState("");
  const [newDateValue, setNewDateValue] = useState("");
  const [selectedDateId, setSelectedDateId] = useState<number | null>(null);
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [participantsTarget, setParticipantsTarget] = useState<number>(0);
  const [seedIds, setSeedIds] = useState<number[]>([]);
  const [drawConflicts, setDrawConflicts] = useState<string[]>([]);
  const [dateWorkspace, setDateWorkspace] = useState<DateWorkspace | null>(null);
  const [dateMessage, setDateMessage] = useState("");
  const [manualPairs, setManualPairs] = useState<Array<{ player1: number; player2: number }>>([]);
  const [manualPairA, setManualPairA] = useState("");
  const [manualPairB, setManualPairB] = useState("");
  const [publicDates, setPublicDates] = useState<TournamentDate[]>([]);
  const [publicDateId, setPublicDateId] = useState<number | null>(null);
  const [publicBracket, setPublicBracket] = useState<BracketMatch[]>([]);
  const [publicZones, setPublicZones] = useState<ZoneComputed[]>([]);
  const [manualPointsPlayerId, setManualPointsPlayerId] = useState("");
  const [manualPointsValue, setManualPointsValue] = useState("");
  const [manualPointsReason, setManualPointsReason] = useState("");
  const [manualPointsBatch, setManualPointsBatch] = useState<Array<{ playerId: number; points: number; reason: string }>>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  const apiAdmin = <T,>(path: string, options?: RequestInit): Promise<T> =>
    api<T>(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken ?? ""}`
      }
    });

  const loadPublicData = async () => {
    const [rankingData, datesData] = await Promise.all([api<Ranking[]>("/ranking"), api<TournamentDate[]>("/public/dates")]);
    setRanking(rankingData);
    setPublicDates(datesData);
    if (datesData.length > 0 && !publicDateId) setPublicDateId(datesData[0].id);
  };

  const loadAdminData = async () => {
    const [playersData, blacklistData, datesData] = await Promise.all([
      apiAdmin<Player[]>("/players"),
      apiAdmin<Player[]>("/blacklist"),
      apiAdmin<TournamentDate[]>("/dates")
    ]);
    setPlayers(playersData);
    setBlacklist(blacklistData);
    setDates(datesData);
    setSelectedBlacklistIds(blacklistData.map((player) => player.id));
    if (!selectedDateId && datesData.length > 0) {
      setSelectedDateId(datesData[0].id);
    }
  };

  const loadLedger = async () => {
    const data = await apiAdmin<LedgerEntry[]>("/ranking/ledger");
    setLedger(data);
  };

  useEffect(() => {
    void loadPublicData();
  }, []);

  useEffect(() => {
    if (!publicDateId) return;
    void Promise.all([
      api<{ bracket: BracketMatch[] }>(`/public/dates/${publicDateId}/bracket`),
      api<{ zones: ZoneComputed[] }>(`/public/dates/${publicDateId}/zones`)
    ])
      .then(([bracketData, zonesData]) => {
        setPublicBracket(bracketData.bracket);
        setPublicZones(zonesData.zones);
      })
      .catch(() => {
        setPublicBracket([]);
        setPublicZones([]);
      });
  }, [publicDateId]);

  useEffect(() => {
    if (adminToken) {
      void loadAdminData().catch((error) => {
        setAdminError(error instanceof Error ? error.message : "No se pudo cargar panel admin");
      });
      void loadLedger().catch(() => setLedger([]));
    }
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken || !selectedDateId) return;
    void apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`)
      .then((workspace) => {
        setDateWorkspace(workspace);
        setAttendeeIds(workspace.registrations.map((player) => player.id));
        setParticipantsTarget(workspace.registrations.length);
        setSeedIds(workspace.seeds.map((seed) => seed.playerId));
        setManualPairs(workspace.draw?.pairs.map((pair) => ({ player1: pair.player1, player2: pair.player2 })) ?? []);
      })
      .catch((error) => {
        setAdminError(error instanceof Error ? error.message : "No se pudo cargar la fecha");
      });
  }, [adminToken, selectedDateId]);

  const playerOptions = useMemo(
    () => players.map((p) => ({ value: String(p.id), label: p.nickname })),
    [players]
  );

  const createPlayer = async () => {
    setFormError("");
    try {
      await apiAdmin("/players", {
        method: "POST",
        body: JSON.stringify({ nickname })
      });
      setNickname("");
      await loadAdminData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el jugador";
      setFormError(message);
    }
  };

  const addToBlacklist = async () => {
    if (!blacklistCandidate) return;
    const nextIds = Array.from(new Set([...selectedBlacklistIds, Number(blacklistCandidate)]));
    setSelectedBlacklistIds(nextIds);
    const data = await apiAdmin<Player[]>("/blacklist", {
      method: "PUT",
      body: JSON.stringify({ playerIds: nextIds })
    });
    setBlacklist(data);
    setBlacklistCandidate("");
  };

  const removeFromBlacklist = async (playerId: number) => {
    const nextIds = selectedBlacklistIds.filter((id) => id !== playerId);
    setSelectedBlacklistIds(nextIds);
    const data = await apiAdmin<Player[]>("/blacklist", {
      method: "PUT",
      body: JSON.stringify({ playerIds: nextIds })
    });
    setBlacklist(data);
  };

  const createTournamentDate = async () => {
    if (!newDateName.trim() || !newDateValue) return;
    try {
      const created = await apiAdmin<TournamentDate>("/dates", {
        method: "POST",
        body: JSON.stringify({ name: newDateName.trim(), eventDate: newDateValue })
      });
      setDates((prev) => [created, ...prev]);
      setSelectedDateId(created.id);
      setNewDateName("");
      setNewDateValue("");
      setDateMessage("Fecha creada.");
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo crear la fecha.");
    }
  };

  const saveRegistrations = async () => {
    if (!selectedDateId) return;
    if (participantsTarget > 0 && attendeeIds.length !== participantsTarget) {
      setDateMessage(`Debes seleccionar exactamente ${participantsTarget} participantes.`);
      return;
    }
    await apiAdmin(`/dates/${selectedDateId}/registrations`, {
      method: "PUT",
      body: JSON.stringify({ playerIds: attendeeIds })
    });
    setDateMessage("Asistentes guardados.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
  };

  const saveSeeds = async () => {
    if (!selectedDateId) return;
    await apiAdmin(`/dates/${selectedDateId}/seeds`, {
      method: "POST",
      body: JSON.stringify({ playerIds: seedIds.slice(0, 4) })
    });
    setDateMessage("Cabezas de serie guardadas.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
  };

  const generateDraw = async () => {
    if (!selectedDateId) return;
    const result = await apiAdmin<{ conflicts: string[] }>(`/dates/${selectedDateId}/draw/generate`, {
      method: "POST"
    });
    setDrawConflicts(result.conflicts);
    setDateMessage("Sorteo generado.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
  };

  const generateZones = async () => {
    if (!selectedDateId) return;
    await apiAdmin(`/dates/${selectedDateId}/zones/generate`, { method: "POST" });
    setDateMessage("Zonas generadas.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
  };

  const addManualPair = () => {
    if (!manualPairA || !manualPairB) return;
    const p1 = Number(manualPairA);
    const p2 = Number(manualPairB);
    if (p1 === p2) return;
    const used = new Set(manualPairs.flatMap((pair) => [pair.player1, pair.player2]));
    if (used.has(p1) || used.has(p2)) return;
    setManualPairs((prev) => [...prev, { player1: p1, player2: p2 }]);
    setManualPairA("");
    setManualPairB("");
  };

  const removeManualPair = (index: number) => {
    setManualPairs((prev) => prev.filter((_, idx) => idx !== index));
  };

  const confirmManualDraw = async () => {
    if (!selectedDateId) return;
    await apiAdmin(`/dates/${selectedDateId}/draw/manual-adjust`, {
      method: "PUT",
      body: JSON.stringify({ pairs: manualPairs })
    });
    setDateMessage("Sorteo manual confirmado.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
  };

  const generateBracket = async () => {
    if (!selectedDateId) return;
    await apiAdmin(`/dates/${selectedDateId}/bracket/generate`, { method: "POST" });
    setDateMessage("Cuadro eliminatorio generado.");
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
    await loadPublicData();
  };

  const updateZoneMatchWinner = async (matchId: number, winnerPairKey: string | null) => {
    if (!selectedDateId) return;
    await apiAdmin(`/dates/${selectedDateId}/zones/matches/${matchId}`, {
      method: "PUT",
      body: JSON.stringify({ winnerPairKey })
    });
    const workspace = await apiAdmin<DateWorkspace>(`/dates/${selectedDateId}/workspace`);
    setDateWorkspace(workspace);
    setDateMessage("Resultado de zona actualizado.");
  };

  const addManualPointsToBatch = () => {
    if (!manualPointsPlayerId || !manualPointsValue || !manualPointsReason.trim()) return;
    setManualPointsBatch((prev) => [
      ...prev,
      {
        playerId: Number(manualPointsPlayerId),
        points: Number(manualPointsValue),
        reason: manualPointsReason.trim()
      }
    ]);
    setManualPointsPlayerId("");
    setManualPointsValue("");
    setManualPointsReason("");
  };

  const removeManualPointsFromBatch = (index: number) => {
    setManualPointsBatch((prev) => prev.filter((_, idx) => idx !== index));
  };

  const submitManualPointsBatch = async () => {
    if (manualPointsBatch.length === 0) return;
    await apiAdmin("/ranking/manual-adjustments", {
      method: "POST",
      body: JSON.stringify({ items: manualPointsBatch })
    });
    setDateMessage("Puntos manuales cargados.");
    setManualPointsBatch([]);
    await Promise.all([loadPublicData(), loadLedger()]);
  };

  const login = async () => {
    setLoginError("");
    try {
      const response = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUser, password: loginPassword })
      });
      localStorage.setItem(ADMIN_TOKEN_KEY, response.token);
      setAdminToken(response.token);
      setLoginPassword("");
      setAdminError("");
      navigate("/admin");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "No se pudo iniciar sesión");
    }
  };

  const logout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
    navigate("/");
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-3 py-4 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-lg">
        <div>
          <h1 className="text-xl font-bold">AppPadel</h1>
          <p className="text-xs text-slate-300 sm:text-sm">Torneo interno de amigos</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">
            Inicio
          </Link>
          {adminToken ? (
            <>
              <Link to="/admin" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">
                Admin
              </Link>
              <button onClick={logout} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm hover:bg-rose-500">
                Salir
              </button>
            </>
          ) : (
            <Link to="/admin" className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400">
              Login admin
            </Link>
          )}
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <section className="grid gap-3 md:grid-cols-2">
              <article className="rounded-2xl bg-white p-4 shadow-md">
                <h2 className="mb-2 text-lg font-semibold text-slate-900">Ranking público</h2>
                <ol className="space-y-2">
                  {ranking.map((row, index) => (
                    <li key={row.playerId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span className="font-medium text-slate-800">
                        {index + 1}. {row.nickname}
                      </span>
                      <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                        {row.points} pts
                      </span>
                    </li>
                  ))}
                </ol>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-md">
                <h2 className="mb-2 text-lg font-semibold text-slate-900">Zonas y cuadro por fecha</h2>
                <select
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={publicDateId ?? ""}
                  onChange={(e) => setPublicDateId(Number(e.target.value))}
                >
                  <option value="">Seleccionar fecha</option>
                  {publicDates.map((date) => (
                    <option key={date.id} value={date.id}>
                      {date.name} - {new Date(date.eventDate).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Zonas</h3>
                <ul className="mb-3 space-y-2 text-sm">
                  {publicZones.map((zone) => (
                    <li key={zone.id} className="rounded-lg bg-slate-50 p-2">
                      <div className="text-xs font-semibold text-slate-500">{zone.name}</div>
                      {zone.pairs.map((pair) => (
                        <div key={pair.key} className="flex items-center justify-between">
                          <span>{pair.label}</span>
                          <span className="text-xs text-slate-500">{pair.wins} G</span>
                        </div>
                      ))}
                    </li>
                  ))}
                  {publicDateId && publicZones.length === 0 ? <li className="text-slate-500">Aún no hay zonas generadas.</li> : null}
                </ul>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Cuadro eliminatorio</h3>
                <ul className="space-y-2 text-sm">
                  {publicBracket.map((match) => (
                    <li key={match.id} className="rounded-lg bg-slate-50 p-2">
                      <div className="text-xs font-semibold text-slate-500">
                        Ronda {match.round} - Match {match.position}
                      </div>
                      <div>{match.pairA ?? "BYE"}</div>
                      <div>{match.pairB ?? "BYE"}</div>
                    </li>
                  ))}
                  {publicDateId && publicBracket.length === 0 ? <li className="text-slate-500">Aún no hay cuadro generado.</li> : null}
                </ul>
              </article>
            </section>
          }
        />
        <Route
          path="/admin"
          element={
            !adminToken ? (
              <section className="mx-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-md">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Ingreso administrador</h2>
                <div className="space-y-2">
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Usuario"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                  <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={() => void login()}>
                    Ingresar
                  </button>
                  {loginError ? <small className="text-rose-600">{loginError}</small> : null}
                </div>
              </section>
            ) : (
              <section className="grid gap-3 md:grid-cols-2">
                <article className="rounded-2xl bg-white p-4 shadow-md">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Alta de jugador</h2>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Apodo"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                  <button className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-white" onClick={() => void createPlayer()}>
                    Guardar jugador
                  </button>
                  {formError ? <small className="text-rose-600">{formError}</small> : null}
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Blacklist (grupo)</h2>
                  <p className="mb-2 text-sm text-slate-600">Al agregar, el cambio impacta inmediatamente.</p>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={blacklistCandidate}
                    onChange={(e) => setBlacklistCandidate(e.target.value)}
                  >
                    <option value="">Seleccionar jugador</option>
                    {playerOptions
                      .filter((option) => !selectedBlacklistIds.includes(Number(option.value)))
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                  <button className="mt-2 w-full rounded-lg bg-cyan-600 px-3 py-2 text-white" onClick={() => void addToBlacklist()}>
                    Agregar a blacklist
                  </button>
                  <h3 className="mt-3 text-sm font-semibold text-slate-700">Listado actual</h3>
                  <ul className="mt-2 space-y-1">
                    {blacklist.map((player) => (
                      <li key={player.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                        <span>{player.nickname}</span>
                        <button
                          className="rounded p-1 text-rose-600 hover:bg-rose-50"
                          aria-label={`Quitar ${player.nickname} de blacklist`}
                          onClick={() => void removeFromBlacklist(player.id)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Historial de parejas</h2>
                  <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={historyA} onChange={(e) => setHistoryA(e.target.value)}>
                    <option value="">Jugador A</option>
                    {playerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={historyB}
                    onChange={(e) => setHistoryB(e.target.value)}
                  >
                    <option value="">Jugador B</option>
                    {playerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-white"
                    onClick={async () => {
                      setHistoryMessage("");
                      const result = await apiAdmin<HistoryResponse>(`/players/${historyA}/partners-history/${historyB}`, {
                        method: "POST"
                      });
                      setHistoryMessage(result.message);
                      if (!result.exists) {
                        setHistoryA("");
                        setHistoryB("");
                      }
                    }}
                  >
                    Agregar historial
                  </button>
                  {historyMessage ? <small className="text-slate-600">{historyMessage}</small> : null}
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Historial por jugador</h2>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={historyLookupPlayer}
                    onChange={(e) => setHistoryLookupPlayer(e.target.value)}
                  >
                    <option value="">Seleccionar jugador</option>
                    {playerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-white"
                    onClick={async () => {
                      setHistoryLookupMessage("");
                      if (!historyLookupPlayer) return;
                      const data = await apiAdmin<Player[]>(`/players/${historyLookupPlayer}/partners-history`);
                      setHistoryLookupResult(data);
                    }}
                  >
                    Ver historial
                  </button>
                  <ul className="mt-2 space-y-1 text-sm">
                    {historyLookupResult.map((player) => (
                      <li key={player.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                        <span>{player.nickname}</span>
                        <button
                          className="rounded px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                          onClick={async () => {
                            if (!historyLookupPlayer) return;
                            await apiAdmin(`/players/${historyLookupPlayer}/partners-history/${player.id}`, {
                              method: "DELETE"
                            });
                            const data = await apiAdmin<Player[]>(`/players/${historyLookupPlayer}/partners-history`);
                            setHistoryLookupResult(data);
                            setHistoryLookupMessage(`Relación eliminada: ${player.nickname}`);
                          }}
                        >
                          Eliminar
                        </button>
                      </li>
                    ))}
                  </ul>
                  {historyLookupMessage ? <small className="text-slate-600">{historyLookupMessage}</small> : null}
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md md:col-span-2">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Nueva fecha de torneo</h2>
                  <div className="grid gap-2 md:grid-cols-3">
                    <input
                      className="rounded-lg border border-slate-200 px-3 py-2"
                      placeholder="Nombre de la fecha"
                      value={newDateName}
                      onChange={(e) => setNewDateName(e.target.value)}
                    />
                    <input
                      className="rounded-lg border border-slate-200 px-3 py-2"
                      type="date"
                      value={newDateValue}
                      onChange={(e) => setNewDateValue(e.target.value)}
                    />
                    <button className="rounded-lg bg-indigo-600 px-3 py-2 text-white" onClick={() => void createTournamentDate()}>
                      Crear fecha
                    </button>
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Seleccionar fecha</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selectedDateId ?? ""}
                      onChange={(e) => setSelectedDateId(Number(e.target.value))}
                    >
                      <option value="">Elegir fecha</option>
                      {dates.map((date) => (
                        <option key={date.id} value={date.id}>
                          {date.name} - {new Date(date.eventDate).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Participantes de la fecha</h3>
                      <input
                        className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                        type="number"
                        min={0}
                        max={players.length}
                        placeholder="Cantidad de participantes"
                        value={participantsTarget || ""}
                        onChange={(e) => setParticipantsTarget(Number(e.target.value))}
                      />
                      <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                        {players.map((player) => (
                          <label key={player.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={attendeeIds.includes(player.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setAttendeeIds((prev) => [...new Set([...prev, player.id])]);
                                } else {
                                  setAttendeeIds((prev) => prev.filter((id) => id !== player.id));
                                }
                              }}
                            />
                            <span>{player.nickname}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Seleccionados: {attendeeIds.length}
                        {participantsTarget > 0 ? ` / ${participantsTarget}` : ""}
                      </p>
                      <button className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={() => void saveRegistrations()}>
                        Guardar asistentes
                      </button>
                    </div>

                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Cabezas de serie (hasta 4)</h3>
                      <select
                        multiple
                        className="h-40 w-full rounded-lg border border-slate-200 px-2 py-1"
                        value={seedIds.map(String)}
                        onChange={(e) =>
                          setSeedIds(Array.from(e.target.selectedOptions, (option) => Number(option.value)).slice(0, 4))
                        }
                      >
                        {players
                          .filter((player) => attendeeIds.includes(player.id))
                          .map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.nickname}
                            </option>
                          ))}
                      </select>
                      <button className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-2 text-white" onClick={() => void saveSeeds()}>
                        Guardar seeds
                      </button>
                    </div>

                    <div className="space-y-2">
                      <button className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => void generateDraw()}>
                        Generar sorteo automático
                      </button>
                      <button className="w-full rounded-lg bg-fuchsia-600 px-3 py-2 text-white" onClick={() => void generateBracket()}>
                        Generar cuadro eliminatorio
                      </button>
                      <button className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-white" onClick={() => void generateZones()}>
                        Generar zonas
                      </button>
                      {dateMessage ? <p className="text-sm text-slate-600">{dateMessage}</p> : null}
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-slate-200 p-3">
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">Ajuste manual del sorteo</h3>
                    <div className="grid gap-2 md:grid-cols-3">
                      <select
                        className="rounded-lg border border-slate-200 px-3 py-2"
                        value={manualPairA}
                        onChange={(e) => setManualPairA(e.target.value)}
                      >
                        <option value="">Jugador 1</option>
                        {players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.nickname}
                          </option>
                        ))}
                      </select>
                      <select
                        className="rounded-lg border border-slate-200 px-3 py-2"
                        value={manualPairB}
                        onChange={(e) => setManualPairB(e.target.value)}
                      >
                        <option value="">Jugador 2</option>
                        {players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.nickname}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={addManualPair}>
                        Agregar pareja manual
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {manualPairs.map((pair, index) => {
                        const p1 = players.find((p) => p.id === pair.player1)?.nickname ?? `#${pair.player1}`;
                        const p2 = players.find((p) => p.id === pair.player2)?.nickname ?? `#${pair.player2}`;
                        return (
                          <li key={`${pair.player1}-${pair.player2}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                            <span>
                              {p1} + {p2}
                            </span>
                            <button className="text-rose-600" onClick={() => removeManualPair(index)}>
                              Quitar
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-white" onClick={() => void confirmManualDraw()}>
                      Confirmar sorteo manual
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Parejas sorteadas</h3>
                      <ul className="space-y-1 text-sm">
                        {dateWorkspace?.draw?.pairs.map((pair) => (
                          <li key={pair.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                            {pair.player1Nickname} + {pair.player2Nickname}
                          </li>
                        )) ?? <li className="text-slate-500">Sin sorteo generado.</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Zonas generadas</h3>
                      <div className="space-y-2 text-sm">
                        {dateWorkspace?.zonesComputed?.map((zone) => (
                          <div key={zone.id} className="rounded-lg bg-slate-50 p-2">
                            <div className="mb-1 text-xs font-semibold text-slate-600">
                              {zone.name} - Clasifican: {zone.qualifiers.map((q) => q.label).join(" | ") || "-"}
                            </div>
                            <ul className="space-y-1">
                              {zone.matches.map((match) => (
                                <li key={match.id} className="rounded bg-white px-2 py-1.5">
                                  <div className="text-xs text-slate-500">
                                    {match.pairALabel} vs {match.pairBLabel}
                                  </div>
                                  <select
                                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs"
                                    value={match.winnerPairKey ?? ""}
                                    onChange={(e) =>
                                      void updateZoneMatchWinner(match.id, e.target.value ? e.target.value : null)
                                    }
                                  >
                                    <option value="">Sin ganador</option>
                                    <option value={match.pairAKey}>{match.pairALabel}</option>
                                    <option value={match.pairBKey}>{match.pairBLabel}</option>
                                  </select>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )) ?? <div className="text-slate-500">Sin zonas generadas.</div>}
                      </div>
                      {drawConflicts.length > 0 ? (
                        <>
                          <h4 className="mt-2 text-xs font-semibold text-rose-700">Conflictos del sorteo</h4>
                          <ul className="space-y-1 text-xs text-rose-700">
                            {drawConflicts.map((conflict) => (
                              <li key={conflict}>- {conflict}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">Cuadro eliminatorio</h3>
                      <ul className="space-y-1 text-sm">
                        {dateWorkspace?.bracket.map((match) => (
                          <li key={match.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                            R{match.round} M{match.position}
                          </li>
                        )) ?? <li className="text-slate-500">Sin cuadro generado.</li>}
                      </ul>
                    </div>
                  </div>
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md md:col-span-2">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Jugadores</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {players.map((player) => (
                      <div key={player.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                        {player.nickname}
                      </div>
                    ))}
                  </div>
                  {adminError ? <small className="text-rose-600">{adminError}</small> : null}
                </article>

                <article className="rounded-2xl bg-white p-4 shadow-md md:col-span-2">
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">Carga manual de puntos (provisoria)</h2>
                  <div className="grid gap-2 md:grid-cols-4">
                    <select
                      className="rounded-lg border border-slate-200 px-3 py-2"
                      value={manualPointsPlayerId}
                      onChange={(e) => setManualPointsPlayerId(e.target.value)}
                    >
                      <option value="">Jugador</option>
                      {players.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.nickname}
                        </option>
                      ))}
                    </select>
                    <input
                      className="rounded-lg border border-slate-200 px-3 py-2"
                      type="number"
                      placeholder="Puntos (+/-)"
                      value={manualPointsValue}
                      onChange={(e) => setManualPointsValue(e.target.value)}
                    />
                    <input
                      className="rounded-lg border border-slate-200 px-3 py-2"
                      placeholder="Motivo (ej: Historial fecha 1)"
                      value={manualPointsReason}
                      onChange={(e) => setManualPointsReason(e.target.value)}
                    />
                    <button className="rounded-lg bg-indigo-600 px-3 py-2 text-white" onClick={addManualPointsToBatch}>
                      Agregar al lote
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Lote pendiente</h3>
                      <ul className="space-y-1 text-sm">
                        {manualPointsBatch.map((item, index) => {
                          const player = players.find((p) => p.id === item.playerId);
                          return (
                            <li key={`${item.playerId}-${item.points}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                              <span>
                                {player?.nickname ?? `#${item.playerId}`}: {item.points} pts ({item.reason})
                              </span>
                              <button className="text-rose-600" onClick={() => removeManualPointsFromBatch(index)}>
                                Quitar
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <button className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => void submitManualPointsBatch()}>
                        Confirmar carga manual
                      </button>
                    </div>

                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-slate-700">Historial reciente de puntos</h3>
                      <ul className="max-h-64 space-y-1 overflow-auto text-sm">
                        {ledger.map((entry) => (
                          <li key={entry.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <span className="font-medium">{entry.player.nickname}</span>: {entry.points} pts - {entry.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              </section>
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

export default App;
