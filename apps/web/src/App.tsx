import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { TournamentBracket } from "./components/TournamentBracket";
import { ScoreInput, isValidSetScore } from "./components/ScoreInput";
import { ADMIN_TOKEN_KEY, api, apiAdmin } from "./lib/api";
import type {
  BracketMatch,
  DateWorkspace,
  HistoryResponse,
  LedgerEntry,
  Player,
  Ranking,
  TournamentDate,
  ZoneComputed
} from "./lib/types";

type AdminSection = "fecha" | "jugadores" | "historial" | "puntos";
type DateStep = 1 | 2 | 3 | 4 | 5;

const formatEventDate = (value: string) =>
  new Date(value).toLocaleDateString("es-AR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

const DATE_STEPS: Array<{ id: DateStep; label: string }> = [
  { id: 1, label: "1. Quién juega" },
  { id: 2, label: "2. Parejas" },
  { id: 3, label: "3. Zonas" },
  { id: 4, label: "4. Cuadro" },
  { id: 5, label: "5. Cerrar" }
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDisplayMode = location.pathname === "/pantalla";
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem(ADMIN_TOKEN_KEY));
  const [loginUser, setLoginUser] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [adminSection, setAdminSection] = useState<AdminSection>("fecha");
  const [dateStep, setDateStep] = useState<DateStep>(1);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [ranking, setRanking] = useState<Ranking[]>([]);
  const [nickname, setNickname] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);
  const [editingNickname, setEditingNickname] = useState("");
  const [formError, setFormError] = useState("");

  const [historyA, setHistoryA] = useState("");
  const [historyB, setHistoryB] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyLookupPlayer, setHistoryLookupPlayer] = useState("");
  const [historyLookupResult, setHistoryLookupResult] = useState<Player[]>([]);

  const [dates, setDates] = useState<TournamentDate[]>([]);
  const [newDateName, setNewDateName] = useState("");
  const [newDateValue, setNewDateValue] = useState("");
  const [selectedDateId, setSelectedDateId] = useState<number | null>(null);
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [dateWorkspace, setDateWorkspace] = useState<DateWorkspace | null>(null);
  const [dateMessage, setDateMessage] = useState("");
  const [seedModeMessage, setSeedModeMessage] = useState("");
  const [drawConflicts, setDrawConflicts] = useState<string[]>([]);
  const [manualPairs, setManualPairs] = useState<Array<{ player1: number; player2: number }>>([]);
  const [manualPairA, setManualPairA] = useState("");
  const [manualPairB, setManualPairB] = useState("");
  const [zoneScores, setZoneScores] = useState<Record<number, string>>({});
  const [bracketScores, setBracketScores] = useState<Record<number, string>>({});

  const [publicDates, setPublicDates] = useState<TournamentDate[]>([]);
  const [publicDateId, setPublicDateId] = useState<number | null>(null);
  const [publicBracket, setPublicBracket] = useState<BracketMatch[]>([]);
  const [publicZones, setPublicZones] = useState<ZoneComputed[]>([]);

  const [manualPointsPlayerId, setManualPointsPlayerId] = useState("");
  const [manualPointsValue, setManualPointsValue] = useState("");
  const [manualPointsReason, setManualPointsReason] = useState("");
  const [manualPointsBatch, setManualPointsBatch] = useState<Array<{ playerId: number; points: number; reason: string }>>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [adminError, setAdminError] = useState("");

  const activePlayers = useMemo(() => players.filter((p) => p.active !== false), [players]);
  const dateLocked = Boolean(dateWorkspace?.locked);

  const loadPublicData = async () => {
    const [rankingData, datesData] = await Promise.all([
      api<Ranking[]>("/ranking"),
      api<TournamentDate[]>("/public/dates")
    ]);
    setRanking(rankingData);
    setPublicDates(datesData);
    if (datesData.length > 0 && !publicDateId) setPublicDateId(datesData[0].id);
  };

  const loadAdminData = async () => {
    const [playersData, datesData] = await Promise.all([
      apiAdmin<Player[]>(adminToken!, "/players"),
      apiAdmin<TournamentDate[]>(adminToken!, "/dates")
    ]);
    setPlayers(playersData);
    setDates(datesData);
    if (!selectedDateId && datesData.length > 0) setSelectedDateId(datesData[0].id);
  };

  const refreshWorkspace = async (dateId: number) => {
    const workspace = await apiAdmin<DateWorkspace>(adminToken!, `/dates/${dateId}/workspace`);
    setDateWorkspace(workspace);
    setAttendeeIds(workspace.registrations.map((player) => player.id));
    setManualPairs(workspace.draw?.pairs.map((pair) => ({ player1: pair.player1, player2: pair.player2 })) ?? []);
    const nextZoneScores: Record<number, string> = {};
    workspace.zonesComputed?.forEach((zone) => {
      zone.matches.forEach((match) => {
        if (match.score) nextZoneScores[match.id] = match.score;
      });
    });
    setZoneScores(nextZoneScores);
    const nextBracketScores: Record<number, string> = {};
    workspace.bracket.forEach((match) => {
      if (match.score) nextBracketScores[match.id] = match.score;
    });
    setBracketScores(nextBracketScores);
    return workspace;
  };

  useEffect(() => {
    void loadPublicData();
  }, []);

  useEffect(() => {
    if (!publicDateId) return;
    const loadDateViews = () =>
      Promise.all([
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

    void loadDateViews();
    if (!isDisplayMode) return;
    const timer = window.setInterval(() => {
      void loadPublicData();
      void loadDateViews();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [publicDateId, isDisplayMode]);

  useEffect(() => {
    if (!adminToken) return;
    void loadAdminData().catch((error) => {
      setAdminError(error instanceof Error ? error.message : "No se pudo cargar el panel");
    });
    void apiAdmin<LedgerEntry[]>(adminToken, "/ranking/ledger")
      .then(setLedger)
      .catch(() => setLedger([]));
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken || !selectedDateId) return;
    void refreshWorkspace(selectedDateId).catch((error) => {
      setAdminError(error instanceof Error ? error.message : "No se pudo cargar la fecha");
    });
  }, [adminToken, selectedDateId]);

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

  const createPlayer = async () => {
    setFormError("");
    try {
      await apiAdmin(adminToken!, "/players", {
        method: "POST",
        body: JSON.stringify({ nickname })
      });
      setNickname("");
      await loadAdminData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo guardar");
    }
  };

  const savePlayerEdit = async () => {
    if (!editingPlayerId || !editingNickname.trim()) return;
    try {
      await apiAdmin(adminToken!, `/players/${editingPlayerId}`, {
        method: "PUT",
        body: JSON.stringify({ nickname: editingNickname.trim() })
      });
      setEditingPlayerId(null);
      setEditingNickname("");
      await loadAdminData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo editar");
    }
  };

  const createTournamentDate = async () => {
    if (!newDateName.trim() || !newDateValue) {
      setDateMessage("Completá el nombre y el día de la fecha.");
      return;
    }
    try {
      const created = await apiAdmin<TournamentDate>(adminToken!, "/dates", {
        method: "POST",
        body: JSON.stringify({ name: newDateName.trim(), eventDate: newDateValue })
      });
      setDates((prev) => [created, ...prev.filter((d) => d.id !== created.id)]);
      setPublicDates((prev) => [created, ...prev.filter((d) => d.id !== created.id)]);
      setSelectedDateId(created.id);
      setPublicDateId(created.id);
      setNewDateName("");
      setNewDateValue("");
      setDateStep(1);
      setDateMessage(`Fecha creada: ${created.name} (${formatEventDate(created.eventDate)}). Ahora elegí quién juega.`);
      await loadAdminData();
      await loadPublicData();
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo crear la fecha");
    }
  };

  const saveRegistrations = async () => {
    if (!selectedDateId) return;
    if (attendeeIds.length < 2 || attendeeIds.length % 2 !== 0) {
      setDateMessage("Elegí una cantidad par de jugadores (mínimo 2).");
      return;
    }
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/registrations`, {
        method: "PUT",
        body: JSON.stringify({ playerIds: attendeeIds })
      });
      await refreshWorkspace(selectedDateId);
      setDateMessage("Jugadores guardados.");
      setDateStep(2);
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudieron guardar");
    }
  };

  const prepareAndDraw = async () => {
    if (!selectedDateId) return;
    try {
      const seeds = await apiAdmin<{
        mode: "random" | "ranking";
        zoneCount: number;
        seeds: Array<{ nickname: string }>;
      }>(adminToken!, `/dates/${selectedDateId}/seeds/auto`, { method: "POST" });
      setSeedModeMessage(
        seeds.mode === "random"
          ? `Primera fecha: ${seeds.zoneCount} cabezas al azar.`
          : `Cabezas = top ${seeds.zoneCount} del ranking.`
      );
      const draw = await apiAdmin<{ conflicts: string[] }>(adminToken!, `/dates/${selectedDateId}/draw/generate`, {
        method: "POST"
      });
      setDrawConflicts(draw.conflicts);
      await refreshWorkspace(selectedDateId);
      await loadAdminData();
      setDateMessage(`Parejas armadas. Cabezas: ${seeds.seeds.map((s) => s.nickname).join(", ")}`);
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudieron armar las parejas");
    }
  };

  const confirmManualDraw = async () => {
    if (!selectedDateId) return;
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/draw/manual-adjust`, {
        method: "PUT",
        body: JSON.stringify({ pairs: manualPairs })
      });
      await refreshWorkspace(selectedDateId);
      setDateMessage("Parejas manuales guardadas.");
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo guardar el ajuste");
    }
  };

  const generateZones = async () => {
    if (!selectedDateId) return;
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/zones/generate`, { method: "POST" });
      await refreshWorkspace(selectedDateId);
      setDateMessage("Zonas listas. Cargá los resultados de cada partido.");
      setDateStep(3);
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudieron generar zonas");
    }
  };

  const updateZoneMatch = async (matchId: number, winnerPairKey: string | null, score: string) => {
    if (!selectedDateId) return;
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/zones/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({ winnerPairKey, score: score.trim() || null })
      });
      await refreshWorkspace(selectedDateId);
      setDateMessage("Resultado actualizado.");
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo guardar el resultado");
    }
  };

  const generateBracket = async () => {
    if (!selectedDateId) return;
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/bracket/generate`, { method: "POST" });
      await refreshWorkspace(selectedDateId);
      await loadPublicData();
      setDateMessage("Cuadro armado.");
      setDateStep(4);
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo armar el cuadro");
    }
  };

  const updateBracketMatch = async (matchId: number, winnerPairKey: string | null, score: string) => {
    if (!selectedDateId) return;
    try {
      await apiAdmin(adminToken!, `/dates/${selectedDateId}/bracket/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({ winnerPairKey, score: score.trim() || null })
      });
      await refreshWorkspace(selectedDateId);
      setDateMessage("Resultado del cuadro actualizado.");
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo guardar");
    }
  };

  const closeDate = async () => {
    if (!selectedDateId) return;
    try {
      const result = await apiAdmin<{ editableUntil: string | null }>(adminToken!, `/dates/${selectedDateId}/close`, {
        method: "POST"
      });
      await refreshWorkspace(selectedDateId);
      await Promise.all([loadPublicData(), loadAdminData()]);
      setDateMessage(
        result.editableUntil
          ? `Fecha cerrada. Se puede corregir hasta ${new Date(result.editableUntil).toLocaleString()}.`
          : "Fecha cerrada."
      );
      setDateStep(5);
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo cerrar la fecha");
    }
  };

  const deleteDate = async () => {
    if (!selectedDateId) return;
    const deletingId = selectedDateId;
    try {
      await apiAdmin(adminToken!, `/dates/${deletingId}`, { method: "DELETE" });
      setShowDeleteConfirm(false);
      setDateWorkspace(null);
      setAttendeeIds([]);
      setManualPairs([]);
      setZoneScores({});
      setBracketScores({});
      setSeedModeMessage("");
      setDrawConflicts([]);
      setDateStep(1);
      await Promise.all([loadAdminData(), loadPublicData()]);
      const remaining = await apiAdmin<TournamentDate[]>(adminToken!, "/dates");
      setDates(remaining);
      const nextId = remaining[0]?.id ?? null;
      setSelectedDateId(nextId);
      if (publicDateId === deletingId) setPublicDateId(nextId);
      setDateMessage("Fecha eliminada (puntos y partidos de esa fecha también). Los jugadores se mantienen.");
    } catch (error) {
      setDateMessage(error instanceof Error ? error.message : "No se pudo eliminar la fecha");
    }
  };

  return (
    <div className={isDisplayMode ? "display-shell" : "app-shell"}>
      {!isDisplayMode ? (
        <header className="app-header">
          <div>
            <p className="brand">AppPadel</p>
            <p>Torneo de amigos · fácil de seguir</p>
          </div>
          <div className="nav-actions">
            <Link className="btn btn-ghost" to="/">
              Ver torneo
            </Link>
            <Link className="btn btn-ghost" to="/pantalla">
              Pantalla grande
            </Link>
            {adminToken ? (
              <>
                <Link className="btn btn-ghost" to="/admin">
                  Organizar
                </Link>
                <button className="btn btn-ghost" onClick={logout}>
                  Salir
                </button>
              </>
            ) : (
              <Link className="btn btn-ball" to="/admin">
                Entrar como organizador
              </Link>
            )}
          </div>
        </header>
      ) : null}

      <Routes>
        <Route
          path="/"
          element={
            <div className="stack">
              <section className="panel">
                <h2>Ranking</h2>
                <p className="panel-lead">Así van los puntos de la temporada.</p>
                <div className="stack">
                  {ranking.map((row, index) => (
                    <div key={row.playerId} className="rank-row">
                      <span>
                        <strong>{index + 1}.</strong> {row.nickname}
                      </span>
                      <span className="rank-points">{row.points} pts</span>
                    </div>
                  ))}
                  {ranking.length === 0 ? <p className="muted">Todavía no hay puntos cargados.</p> : null}
                </div>
              </section>

              <section className="panel">
                <h2>Fecha en curso</h2>
                <p className="panel-lead">Elegí la fecha para ver zonas y el cuadro.</p>
                <div className="field">
                  <label htmlFor="public-date">Fecha</label>
                  <select
                    id="public-date"
                    value={publicDateId ?? ""}
                    onChange={(e) => setPublicDateId(Number(e.target.value))}
                  >
                    <option value="">Elegir fecha</option>
                    {publicDates.map((date) => (
                      <option key={date.id} value={date.id}>
                        {date.name} · {formatEventDate(date.eventDate)}
                      </option>
                    ))}
                  </select>
                </div>

                <h3 style={{ marginTop: "1rem" }}>Zonas</h3>
                <div className="stack" style={{ marginTop: "0.75rem" }}>
                  {publicZones.map((zone) => (
                    <div key={zone.id} className="zone-block">
                      <h3>{zone.name}</h3>
                      <div className="stack">
                        {zone.pairs.map((pair, idx) => (
                          <div key={pair.key} className="pair-row">
                            <span>
                              {idx + 1}. {pair.label}
                            </span>
                            <span className="muted">{pair.wins} ganados</span>
                          </div>
                        ))}
                      </div>
                      <div className="stack" style={{ marginTop: "0.75rem" }}>
                        {zone.matches.map((match) => (
                          <div key={match.id} className="pair-row" style={{ display: "block" }}>
                            <div>
                              {match.pairALabel} vs {match.pairBLabel}
                            </div>
                            {match.score ? <div className="muted">{match.score}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {publicDateId && publicZones.length === 0 ? (
                    <p className="muted">Aún no hay zonas para esta fecha.</p>
                  ) : null}
                </div>

                <h3 style={{ marginTop: "1.25rem" }}>Cuadro eliminatorio</h3>
                <div style={{ marginTop: "0.75rem" }}>
                  <TournamentBracket matches={publicBracket} />
                </div>
                <Link className="btn btn-primary" to="/pantalla" style={{ marginTop: "1rem" }}>
                  Abrir pantalla grande (TV / celular)
                </Link>
              </section>
            </div>
          }
        />

        <Route
          path="/pantalla"
          element={
            <div className="display-layout">
              <header className="display-top">
                <div>
                  <p className="brand">AppPadel</p>
                  <p>Modo pantalla · se actualiza solo</p>
                </div>
                <div className="nav-actions">
                  <select
                    className="display-select"
                    value={publicDateId ?? ""}
                    onChange={(e) => setPublicDateId(Number(e.target.value))}
                    aria-label="Fecha a mostrar"
                  >
                    <option value="">Elegir fecha</option>
                    {publicDates.map((date) => (
                      <option key={date.id} value={date.id}>
                        {date.name} · {formatEventDate(date.eventDate)}
                      </option>
                    ))}
                  </select>
                  <Link className="btn btn-ball" to="/">
                    Salir de pantalla
                  </Link>
                </div>
              </header>

              <div className="display-grid">
                <section className="display-panel">
                  <h2>Ranking</h2>
                  <ol className="display-rank">
                    {ranking.slice(0, 12).map((row, index) => (
                      <li key={row.playerId}>
                        <span>
                          {index + 1}. {row.nickname}
                        </span>
                        <strong>{row.points}</strong>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="display-panel display-wide">
                  <h2>Zonas</h2>
                  <div className="display-zones">
                    {publicZones.map((zone) => (
                      <div key={zone.id} className="display-zone">
                        <h3>{zone.name}</h3>
                        {zone.pairs.map((pair, idx) => (
                          <div key={pair.key} className="display-zone-row">
                            <span>
                              {idx + 1}. {pair.label}
                            </span>
                            <span>{pair.wins}G</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {publicDateId && publicZones.length === 0 ? (
                      <p className="muted">Sin zonas todavía.</p>
                    ) : null}
                  </div>
                </section>
              </div>

              <section className="display-panel" style={{ marginTop: "1rem" }}>
                <h2>Cuadro eliminatorio</h2>
                <TournamentBracket matches={publicBracket} />
              </section>
            </div>
          }
        />

        <Route
          path="/admin"
          element={
            !adminToken ? (
              <section className="panel" style={{ maxWidth: 420, margin: "0 auto" }}>
                <h2>Organizador</h2>
                <p className="panel-lead">Solo para quien arma el torneo del día.</p>
                <div className="field">
                  <label htmlFor="user">Usuario</label>
                  <input id="user" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="pass">Contraseña</label>
                  <input
                    id="pass"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => void login()}>
                  Entrar
                </button>
                {loginError ? <p className="msg msg-error">{loginError}</p> : null}
              </section>
            ) : (
              <div className="stack">
                <nav className="admin-nav" aria-label="Secciones del organizador">
                  <button
                    className={`btn ${adminSection === "fecha" ? "btn-primary" : "btn-soft"}`}
                    onClick={() => setAdminSection("fecha")}
                  >
                    Fecha de hoy
                  </button>
                  <button
                    className={`btn ${adminSection === "jugadores" ? "btn-primary" : "btn-soft"}`}
                    onClick={() => setAdminSection("jugadores")}
                  >
                    Jugadores
                  </button>
                  <button
                    className={`btn ${adminSection === "historial" ? "btn-primary" : "btn-soft"}`}
                    onClick={() => setAdminSection("historial")}
                  >
                    Historial
                  </button>
                </nav>

                <details
                  className="advanced-box"
                  open={showAdvanced || adminSection === "puntos"}
                  onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
                >
                  <summary>Opciones avanzadas</summary>
                  <p className="muted" style={{ margin: "0.5rem 0 0.75rem" }}>
                    Cosas que casi no hace falta tocar en el día a día.
                  </p>
                  <button
                    className={`btn ${adminSection === "puntos" ? "btn-warn" : "btn-soft"}`}
                    onClick={() => setAdminSection("puntos")}
                  >
                    Ajuste manual de puntos
                  </button>
                </details>

                {adminSection === "jugadores" ? (
                  <section className="panel">
                    <h2>Jugadores</h2>
                    <p className="panel-lead">Agregá apodos. Después los marcás en cada fecha.</p>
                    <div className="field">
                      <label htmlFor="nick">Apodo nuevo</label>
                      <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} />
                    </div>
                    <button className="btn btn-primary" onClick={() => void createPlayer()}>
                      Agregar jugador
                    </button>
                    {formError ? <p className="msg msg-error">{formError}</p> : null}
                    <div className="stack" style={{ marginTop: "1rem" }}>
                      {players.map((player) => (
                        <div key={player.id} className="pair-row">
                          {editingPlayerId === player.id ? (
                            <div style={{ display: "grid", gap: "0.4rem", width: "100%" }}>
                              <input value={editingNickname} onChange={(e) => setEditingNickname(e.target.value)} />
                              <div className="btn-row">
                                <button className="btn btn-ok" onClick={() => void savePlayerEdit()}>
                                  Guardar
                                </button>
                                <button className="btn btn-soft" onClick={() => setEditingPlayerId(null)}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <span className={player.active === false ? "muted" : ""}>{player.nickname}</span>
                              <div className="btn-row">
                                <button
                                  className="btn btn-soft"
                                  onClick={() => {
                                    setEditingPlayerId(player.id);
                                    setEditingNickname(player.nickname);
                                  }}
                                >
                                  Editar
                                </button>
                                {player.active === false ? (
                                  <button
                                    className="btn btn-ok"
                                    onClick={() =>
                                      void apiAdmin(adminToken, `/players/${player.id}`, {
                                        method: "PUT",
                                        body: JSON.stringify({ active: true })
                                      }).then(loadAdminData)
                                    }
                                  >
                                    Activar
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-danger"
                                    onClick={() =>
                                      void apiAdmin(adminToken, `/players/${player.id}`, { method: "DELETE" }).then(
                                        loadAdminData
                                      )
                                    }
                                  >
                                    Baja
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {adminSection === "historial" ? (
                  <section className="panel">
                    <h2>Historial de parejas</h2>
                    <p className="panel-lead">Quiénes ya jugaron juntos (para no repetir).</p>
                    <div className="grid-2">
                      <div>
                        <div className="field">
                          <label>Jugador A</label>
                          <select value={historyA} onChange={(e) => setHistoryA(e.target.value)}>
                            <option value="">Elegir</option>
                            {activePlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nickname}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Jugador B</label>
                          <select value={historyB} onChange={(e) => setHistoryB(e.target.value)}>
                            <option value="">Elegir</option>
                            {activePlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nickname}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="btn btn-ok"
                          onClick={async () => {
                            const result = await apiAdmin<HistoryResponse>(
                              adminToken,
                              `/players/${historyA}/partners-history/${historyB}`,
                              { method: "POST" }
                            );
                            setHistoryMessage(result.message);
                          }}
                        >
                          Agregar relación
                        </button>
                        {historyMessage ? <p className="msg">{historyMessage}</p> : null}
                      </div>
                      <div>
                        <div className="field">
                          <label>Ver historial de</label>
                          <select
                            value={historyLookupPlayer}
                            onChange={(e) => setHistoryLookupPlayer(e.target.value)}
                          >
                            <option value="">Elegir</option>
                            {activePlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nickname}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="btn btn-primary"
                          onClick={async () => {
                            if (!historyLookupPlayer) return;
                            setHistoryLookupResult(
                              await apiAdmin<Player[]>(adminToken, `/players/${historyLookupPlayer}/partners-history`)
                            );
                          }}
                        >
                          Ver
                        </button>
                        <div className="stack" style={{ marginTop: "0.75rem" }}>
                          {historyLookupResult.map((player) => (
                            <div key={player.id} className="pair-row">
                              <span>{player.nickname}</span>
                              <button
                                className="btn btn-danger"
                                onClick={async () => {
                                  await apiAdmin(
                                    adminToken,
                                    `/players/${historyLookupPlayer}/partners-history/${player.id}`,
                                    { method: "DELETE" }
                                  );
                                  setHistoryLookupResult(
                                    await apiAdmin<Player[]>(
                                      adminToken,
                                      `/players/${historyLookupPlayer}/partners-history`
                                    )
                                  );
                                }}
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {adminSection === "puntos" ? (
                  <section className="panel">
                    <h2>Ajuste manual de puntos</h2>
                    <p className="panel-lead">Solo para correcciones. Lo normal es cerrar la fecha y que sume solo.</p>
                    <div className="grid-2">
                      <div>
                        <div className="field">
                          <label>Jugador</label>
                          <select value={manualPointsPlayerId} onChange={(e) => setManualPointsPlayerId(e.target.value)}>
                            <option value="">Elegir</option>
                            {activePlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nickname}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Puntos (+/-)</label>
                          <input
                            type="number"
                            value={manualPointsValue}
                            onChange={(e) => setManualPointsValue(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Motivo</label>
                          <input value={manualPointsReason} onChange={(e) => setManualPointsReason(e.target.value)} />
                        </div>
                        <button
                          className="btn btn-soft"
                          onClick={() => {
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
                          }}
                        >
                          Agregar al lote
                        </button>
                        <button
                          className="btn btn-warn"
                          style={{ marginTop: "0.5rem" }}
                          onClick={async () => {
                            if (manualPointsBatch.length === 0) return;
                            await apiAdmin(adminToken, "/ranking/manual-adjustments", {
                              method: "POST",
                              body: JSON.stringify({ items: manualPointsBatch })
                            });
                            setManualPointsBatch([]);
                            await Promise.all([
                              loadPublicData(),
                              apiAdmin<LedgerEntry[]>(adminToken, "/ranking/ledger").then(setLedger)
                            ]);
                          }}
                        >
                          Confirmar lote
                        </button>
                        <ul className="stack" style={{ marginTop: "0.75rem" }}>
                          {manualPointsBatch.map((item, index) => (
                            <li key={`${item.playerId}-${index}`} className="pair-row">
                              <span>
                                {players.find((p) => p.id === item.playerId)?.nickname}: {item.points}
                              </span>
                              <button
                                className="btn btn-danger"
                                onClick={() => setManualPointsBatch((prev) => prev.filter((_, i) => i !== index))}
                              >
                                Quitar
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3>Últimos movimientos</h3>
                        <div className="stack" style={{ marginTop: "0.5rem", maxHeight: 320, overflow: "auto" }}>
                          {ledger.map((entry) => (
                            <div key={entry.id} className="pair-row" style={{ display: "block" }}>
                              <strong>{entry.player.nickname}</strong>: {entry.points} · {entry.reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {adminSection === "fecha" ? (
                  <section className="panel">
                    <h2>Fecha de hoy</h2>
                    <p className="panel-lead">Seguí los pasos. No hace falta tocar todo a la vez.</p>

                    <div className="grid-2">
                      <div className="field">
                        <label>Nombre de la fecha</label>
                        <input
                          placeholder="Ej: Fecha 1"
                          value={newDateName}
                          onChange={(e) => setNewDateName(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>Día</label>
                        <input type="date" value={newDateValue} onChange={(e) => setNewDateValue(e.target.value)} />
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={() => void createTournamentDate()}>
                      Crear fecha nueva
                    </button>

                    <div className="field" style={{ marginTop: "1rem" }}>
                      <label>O elegir una fecha ya creada</label>
                      <select
                        value={selectedDateId ?? ""}
                        onChange={(e) => {
                          setSelectedDateId(Number(e.target.value));
                          setDateStep(1);
                          setShowDeleteConfirm(false);
                        }}
                      >
                        <option value="">Elegir</option>
                        {dates.map((date) => (
                          <option key={date.id} value={date.id}>
                            {date.name} · {formatEventDate(date.eventDate)} ({date.status})
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedDateId ? (
                      !showDeleteConfirm ? (
                        <button
                          className="btn btn-danger"
                          style={{ marginTop: "0.5rem" }}
                          onClick={() => setShowDeleteConfirm(true)}
                        >
                          Eliminar esta fecha
                        </button>
                      ) : (
                        <div className="confirm-box" style={{ marginTop: "0.75rem" }}>
                          <p>
                            <strong>¿Eliminar esta fecha por completo?</strong>
                          </p>
                          <p className="muted">
                            Se borran sorteo, zonas, cuadro y puntos de esta fecha. Los jugadores del sistema se
                            mantienen.
                          </p>
                          <div className="btn-row">
                            <button className="btn btn-danger" onClick={() => void deleteDate()}>
                              Sí, eliminar fecha
                            </button>
                            <button className="btn btn-soft" onClick={() => setShowDeleteConfirm(false)}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )
                    ) : null}

                    {dateWorkspace ? (
                      <p
                        className={`status-pill ${
                          dateWorkspace.locked
                            ? "status-lock"
                            : dateWorkspace.date.status === "CLOSED"
                              ? "status-edit"
                              : "status-open"
                        }`}
                      >
                        {dateWorkspace.locked
                          ? "Bloqueada"
                          : dateWorkspace.date.status === "CLOSED"
                            ? `Cerrada · editable hasta ${
                                dateWorkspace.editableUntil
                                  ? new Date(dateWorkspace.editableUntil).toLocaleString()
                                  : "-"
                              }`
                            : "Abierta"}
                      </p>
                    ) : null}

                    <div className="steps" role="tablist" aria-label="Pasos de la fecha">
                      {DATE_STEPS.map((step) => (
                        <button
                          key={step.id}
                          type="button"
                          className={`step-chip ${dateStep === step.id ? "is-active" : ""} ${
                            dateStep > step.id ? "is-done" : ""
                          }`}
                          onClick={() => setDateStep(step.id)}
                        >
                          {step.label}
                        </button>
                      ))}
                    </div>

                    {dateStep === 1 ? (
                      <div>
                        <h3>¿Quiénes juegan hoy?</h3>
                        <p className="muted">Marcá a los presentes. Tiene que ser cantidad par.</p>
                        <div className="list-check" style={{ marginTop: "0.75rem" }}>
                          {activePlayers.map((player) => (
                            <label key={player.id}>
                              <input
                                type="checkbox"
                                checked={attendeeIds.includes(player.id)}
                                disabled={dateLocked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setAttendeeIds((prev) => [...new Set([...prev, player.id])]);
                                  } else {
                                    setAttendeeIds((prev) => prev.filter((id) => id !== player.id));
                                  }
                                }}
                              />
                              {player.nickname}
                            </label>
                          ))}
                        </div>
                        <p className="muted" style={{ marginTop: "0.5rem" }}>
                          Seleccionados: {attendeeIds.length}
                        </p>
                        <button className="btn btn-primary" disabled={dateLocked} onClick={() => void saveRegistrations()}>
                          Guardar y seguir
                        </button>
                      </div>
                    ) : null}

                    {dateStep === 2 ? (
                      <div className="stack">
                        <div>
                          <h3>Armar parejas</h3>
                          <p className="muted">
                            Un botón prepara las cabezas y sortea respetando historial y restricciones.
                          </p>
                          <button className="btn btn-ok" disabled={dateLocked} onClick={() => void prepareAndDraw()}>
                            Preparar cabezas y sortear
                          </button>
                          {seedModeMessage ? <p className="msg">{seedModeMessage}</p> : null}
                          {dateWorkspace?.seeds.length ? (
                            <p className="muted">Cabezas: {dateWorkspace.seeds.map((s) => s.nickname).join(", ")}</p>
                          ) : null}
                        </div>

                        <div>
                          <h4>Parejas</h4>
                          <div className="stack" style={{ marginTop: "0.5rem" }}>
                            {dateWorkspace?.draw?.pairs.map((pair) => (
                              <div key={pair.id} className="pair-row">
                                {pair.player1Nickname} + {pair.player2Nickname}
                              </div>
                            )) ?? <p className="muted">Todavía no hay sorteo.</p>}
                          </div>
                          {drawConflicts.length > 0 ? (
                            <p className="msg msg-error">{drawConflicts.join(" · ")}</p>
                          ) : null}
                        </div>

                        <details>
                          <summary>¿Hace falta corregir a mano?</summary>
                          <div className="stack" style={{ marginTop: "0.75rem" }}>
                            <div className="grid-2">
                              <select
                                className="control"
                                value={manualPairA}
                                disabled={dateLocked}
                                onChange={(e) => setManualPairA(e.target.value)}
                              >
                                <option value="">Jugador 1</option>
                                {activePlayers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nickname}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="control"
                                value={manualPairB}
                                disabled={dateLocked}
                                onChange={(e) => setManualPairB(e.target.value)}
                              >
                                <option value="">Jugador 2</option>
                                {activePlayers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nickname}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="btn btn-soft"
                              disabled={dateLocked}
                              onClick={() => {
                                if (!manualPairA || !manualPairB) return;
                                const p1 = Number(manualPairA);
                                const p2 = Number(manualPairB);
                                if (p1 === p2) return;
                                setManualPairs((prev) => [...prev, { player1: p1, player2: p2 }]);
                                setManualPairA("");
                                setManualPairB("");
                              }}
                            >
                              Agregar pareja
                            </button>
                            {manualPairs.map((pair, index) => (
                              <div key={`${pair.player1}-${pair.player2}-${index}`} className="pair-row">
                                <span>
                                  {players.find((p) => p.id === pair.player1)?.nickname} +{" "}
                                  {players.find((p) => p.id === pair.player2)?.nickname}
                                </span>
                                <button
                                  className="btn btn-danger"
                                  disabled={dateLocked}
                                  onClick={() => setManualPairs((prev) => prev.filter((_, i) => i !== index))}
                                >
                                  Quitar
                                </button>
                              </div>
                            ))}
                            <button className="btn btn-warn" disabled={dateLocked} onClick={() => void confirmManualDraw()}>
                              Confirmar ajuste manual
                            </button>
                          </div>
                        </details>

                        <button className="btn btn-primary" disabled={dateLocked} onClick={() => void generateZones()}>
                          Generar zonas y seguir
                        </button>
                      </div>
                    ) : null}

                    {dateStep === 3 ? (
                      <div className="stack">
                        <h3>Resultados de zona</h3>
                        <p className="muted">
                          Escribí el marcador (ej: 6-2) y elegí el ganador. Se guarda solo. Clasifican hasta 3
                          parejas: el 1º pasa directo; 2º y 3º juegan entre zonas en la ronda previa del cuadro.
                        </p>
                        {dateWorkspace?.zonesComputed?.map((zone) => (
                          <div key={zone.id} className="zone-block">
                            <h3>
                              {zone.name} ·{" "}
                              {zone.qualifiers.length
                                ? zone.qualifiers
                                    .map((q) => `${q.place ?? "?"}º ${q.label}`)
                                    .join(" · ")
                                : "sin clasificación aún"}
                            </h3>
                            <div className="stack" style={{ marginBottom: "0.75rem" }}>
                              {zone.pairs.map((pair, idx) => (
                                <div key={pair.key} className="pair-row">
                                  <span>
                                    {idx + 1}. {pair.label}
                                  </span>
                                  <span className="muted">{pair.wins}G</span>
                                </div>
                              ))}
                            </div>
                            {zone.matches.map((match) => (
                              <div key={match.id} className="match-editor">
                                <div className="teams">
                                  {match.pairALabel} vs {match.pairBLabel}
                                </div>
                                <ScoreInput
                                  className="control"
                                  placeholder="Ej: 6-2"
                                  disabled={dateLocked}
                                  value={zoneScores[match.id] ?? match.score ?? ""}
                                  onChange={(next) => setZoneScores((prev) => ({ ...prev, [match.id]: next }))}
                                  onCompleteBlur={(complete) => {
                                    if (!match.winnerPairKey) return;
                                    void updateZoneMatch(match.id, match.winnerPairKey, complete);
                                  }}
                                />
                                <select
                                  className="control"
                                  disabled={dateLocked}
                                  value={match.winnerPairKey ?? ""}
                                  onChange={(e) => {
                                    const winner = e.target.value ? e.target.value : null;
                                    const score = zoneScores[match.id] ?? match.score ?? "";
                                    if (winner && !isValidSetScore(score)) {
                                      setDateMessage("Antes elegí un marcador válido (ej: 6-2 o 7-6).");
                                      return;
                                    }
                                    void updateZoneMatch(match.id, winner, score);
                                  }}
                                >
                                  <option value="">Elegir ganador</option>
                                  <option value={match.pairAKey}>{match.pairALabel}</option>
                                  <option value={match.pairBKey}>{match.pairBLabel}</option>
                                </select>
                              </div>
                            ))}
                          </div>
                        )) ?? <p className="muted">Todavía no hay zonas.</p>}
                        <button className="btn btn-primary" disabled={dateLocked} onClick={() => void generateBracket()}>
                          Armar cuadro eliminatorio
                        </button>
                      </div>
                    ) : null}

                    {dateStep === 4 ? (
                      <div className="stack">
                        <h3>Cuadro eliminatorio</h3>
                        <p className="muted">
                          En la primera ronda: los 1º de zona avanzan con bye; los 2º enfrentan a 3º de otra zona.
                          Completá marcador y ganador: el ganador avanza solo.
                        </p>
                        <TournamentBracket
                          matches={dateWorkspace?.bracket ?? []}
                          editable
                          locked={dateLocked}
                          scores={bracketScores}
                          onScoreChange={(matchId, score) =>
                            setBracketScores((prev) => ({ ...prev, [matchId]: score }))
                          }
                          onResultChange={(matchId, winnerPairKey, score) =>
                            void updateBracketMatch(matchId, winnerPairKey, score)
                          }
                        />
                        <button className="btn btn-soft" onClick={() => setDateStep(5)}>
                          Ir a cerrar fecha
                        </button>
                      </div>
                    ) : null}

                    {dateStep === 5 ? (
                      <div className="stack">
                        <h3>Cerrar fecha</h3>
                        <p className="muted">
                          Al cerrar se suman los puntos solos y se guarda el historial de parejas. La{" "}
                          <strong>primera fecha</strong> de la temporada suma <strong>doble</strong>. Después tenés 24
                          hs para corregir.
                        </p>
                        {!showCloseConfirm ? (
                          <button
                            className="btn btn-danger"
                            disabled={dateLocked}
                            onClick={() => setShowCloseConfirm(true)}
                          >
                            Cerrar fecha y sumar puntos
                          </button>
                        ) : (
                          <div className="confirm-box">
                            <p>
                              <strong>¿Seguro que querés cerrar esta fecha?</strong>
                            </p>
                            <p className="muted">
                              Se van a sumar los puntos del cuadro y se guardará el historial de parejas.
                            </p>
                            <div className="btn-row">
                              <button
                                className="btn btn-danger"
                                disabled={dateLocked}
                                onClick={() => {
                                  setShowCloseConfirm(false);
                                  void closeDate();
                                }}
                              >
                                Sí, cerrar y sumar puntos
                              </button>
                              <button className="btn btn-soft" onClick={() => setShowCloseConfirm(false)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {dateMessage ? <p className="msg">{dateMessage}</p> : null}
                    {adminError ? <p className="msg msg-error">{adminError}</p> : null}
                  </section>
                ) : null}
              </div>
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
