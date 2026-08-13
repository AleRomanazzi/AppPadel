import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Prisma, type TournamentDate } from "@prisma/client";
import { STAGE_POINTS, type Division, type Stage } from "@apppadel/shared";
import { prisma } from "./db.js";
import {
  dateIncludeEvent,
  divisionFromRequest,
  eventIncludeDates,
  parseDivision,
  parseDivisions,
  requireDivisionFromRequest,
  serializeDate,
  serializeEvent
} from "./division.js";
import { generatePairs, normalizePair, pairKey, validatePair } from "./pairing.js";
import { scoreDiffForPair, isValidSetScore } from "./score.js";
import { zoneIndexBySeedRank } from "./seedPlacement.js";
import { buildZoneSizes, qualifierCountForZoneSize } from "./zoneLayout.js";
import {
  getBracketTemplate,
  hasBracketTemplate,
  qualifierKey,
  resolveRound1Matchups,
  type ResolvedPair
} from "./bracketTemplates.js";
import { computeStageAssignments } from "./stages.js";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const app = express();
app.use(
  helmet({
    // La API se consume desde otro origen (Vercel); same-origin bloquea el fetch del front.
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean)
  .flatMap((value) => {
    if (value.startsWith("http://") || value.startsWith("https://")) return [value];
    return [`https://${value}`, `http://${value}`];
  });
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
app.use(express.json());

const port = Number(process.env.PORT ?? 4000);
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "adminPadel.2026";
const ADMIN_TOKEN = "admin-token-apppadel-2026";

const requireAdmin: express.RequestHandler = (req, res, next) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }
  next();
};

const isDateLocked = (date: TournamentDate): boolean => {
  if (date.status !== "CLOSED" || !date.closedAt) return false;
  return Date.now() > date.closedAt.getTime() + EDIT_WINDOW_MS;
};

const editableUntil = (date: TournamentDate): string | null => {
  if (date.status !== "CLOSED" || !date.closedAt) return null;
  return new Date(date.closedAt.getTime() + EDIT_WINDOW_MS).toISOString();
};

const assertDateEditable = async (dateId: number): Promise<TournamentDate> => {
  const date = await prisma.tournamentDate.findUnique({ where: { id: dateId } });
  if (!date) {
    const error = new Error("Fecha no encontrada") as Error & { status: number };
    error.status = 404;
    throw error;
  }
  if (isDateLocked(date)) {
    const error = new Error("La fecha está cerrada y ya pasaron las 24 hs de edición.") as Error & {
      status: number;
    };
    error.status = 403;
    throw error;
  }
  return date;
};

const handleDateGuardError = (error: unknown, res: express.Response): boolean => {
  if (error instanceof Error && "status" in error) {
    const status = (error as Error & { status: number }).status;
    res.status(status).json({ error: error.message });
    return true;
  }
  return false;
};

const getConstraints = async (division: Division) => {
  const [blacklistedPlayers, historyPairs] = await Promise.all([
    prisma.blacklistedPlayer.findMany({
      where: { player: { division } }
    }),
    prisma.partnerHistory.findMany({ where: { division } })
  ]);
  const blacklistedIds = blacklistedPlayers.map((item) => item.playerId);
  const blacklist = new Set<string>();

  for (let i = 0; i < blacklistedIds.length; i += 1) {
    for (let j = i + 1; j < blacklistedIds.length; j += 1) {
      blacklist.add(pairKey(blacklistedIds[i], blacklistedIds[j]));
    }
  }

  return {
    blacklist,
    history: new Set(historyPairs.map((item) => pairKey(item.playerAId, item.playerBId)))
  };
};

const shuffle = <T,>(items: T[]): T[] => {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

const getRankingScores = async (division: Division): Promise<Map<number, number>> => {
  const players = await prisma.player.findMany({
    where: { active: true, division },
    include: { pointsEntries: true }
  });
  return new Map(
    players.map((player) => [
      player.id,
      player.pointsEntries.reduce((sum, item) => sum + item.points, 0)
    ])
  );
};

const hasAnyRankingPoints = async (division: Division): Promise<boolean> => {
  const entry = await prisma.rankingPointEntry.findFirst({
    where: { player: { division } },
    select: { id: true }
  });
  return Boolean(entry);
};

const loadDateWithEvent = async (dateId: number) =>
  prisma.tournamentDate.findUnique({
    where: { id: dateId },
    include: dateIncludeEvent
  });

const assertPlayersMatchDivision = async (playerIds: number[], division: Division): Promise<string | null> => {
  if (playerIds.length === 0) return null;
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, division: true, nickname: true }
  });
  const wrong = players.filter((player) => player.division !== division);
  if (wrong.length === 0) return null;
  return `Jugadores de otra categoría: ${wrong.map((p) => p.nickname).join(", ")}`;
};

type ZonePairStat = {
  key: string;
  label: string;
  player1: number;
  player2: number;
  wins: number;
  played: number;
  setDiff: number;
  gameDiff: number;
};

type ZoneComputed = {
  id: number;
  name: string;
  pairs: ZonePairStat[];
  matches: Array<{
    id: number;
    pairAKey: string;
    pairBKey: string;
    pairALabel: string;
    pairBLabel: string;
    score: string | null;
    winnerPairKey: string | null;
  }>;
  qualifiers: Array<{
    key: string;
    label: string;
    player1: number;
    player2: number;
    place: number;
  }>;
};

const buildZonesComputed = async (dateId: number): Promise<ZoneComputed[]> => {
  const [zones, matches, players] = await Promise.all([
    prisma.zone.findMany({ where: { dateId }, orderBy: { name: "asc" } }),
    prisma.zoneMatch.findMany({ where: { dateId }, orderBy: { id: "asc" } }),
    prisma.player.findMany({ select: { id: true, nickname: true } })
  ]);

  const playersById = new Map(players.map((player) => [player.id, player.nickname]));

  return zones.map((zone) => {
    const zoneMatches = matches.filter((match) => match.zoneName === zone.name);
    const pairsMap = new Map<string, ZonePairStat>();

    const ensurePair = (p1: number, p2: number) => {
      const key = pairKey(p1, p2);
      if (!pairsMap.has(key)) {
        pairsMap.set(key, {
          key,
          label: `${playersById.get(p1) ?? `#${p1}`} + ${playersById.get(p2) ?? `#${p2}`}`,
          player1: p1,
          player2: p2,
          wins: 0,
          played: 0,
          setDiff: 0,
          gameDiff: 0
        });
      }
      return key;
    };

    const normalizedMatches = zoneMatches.map((match) => {
      const pairAKey = ensurePair(match.pairAPlayer1, match.pairAPlayer2);
      const pairBKey = ensurePair(match.pairBPlayer1, match.pairBPlayer2);
      return {
        id: match.id,
        pairAKey,
        pairBKey,
        pairALabel: pairsMap.get(pairAKey)?.label ?? pairAKey,
        pairBLabel: pairsMap.get(pairBKey)?.label ?? pairBKey,
        score: match.score,
        winnerPairKey: match.winnerPairKey
      };
    });

    normalizedMatches.forEach((match) => {
      const pairA = pairsMap.get(match.pairAKey);
      const pairB = pairsMap.get(match.pairBKey);
      if (pairA) pairA.played += 1;
      if (pairB) pairB.played += 1;
      if (match.winnerPairKey && pairsMap.has(match.winnerPairKey)) {
        const winner = pairsMap.get(match.winnerPairKey);
        if (winner) winner.wins += 1;
      }
      if (match.score && pairA && pairB) {
        const aDiff = scoreDiffForPair(match.score, true);
        const bDiff = scoreDiffForPair(match.score, false);
        pairA.setDiff += aDiff.setDiff;
        pairA.gameDiff += aDiff.gameDiff;
        pairB.setDiff += bDiff.setDiff;
        pairB.gameDiff += bDiff.gameDiff;
      }
    });

    const sortedPairs = Array.from(pairsMap.values()).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff;
      if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
      return a.label.localeCompare(b.label);
    });

    return {
      id: zone.id,
      name: zone.name,
      pairs: sortedPairs,
      matches: normalizedMatches,
      // Clasifican hasta 3 (o 4 si la zona es de 4, p.ej. 16 parejas).
      qualifiers: sortedPairs
        .slice(0, qualifierCountForZoneSize(zone.size, sortedPairs.length))
        .map((pair, index) => ({
        key: pair.key,
        label: pair.label,
        player1: pair.player1,
        player2: pair.player2,
        place: index + 1
      }))
    };
  });
};

const pairLabel = (
  p1: number | null,
  p2: number | null,
  playersById: Map<number, string>
): string | null => {
  if (p1 == null || p2 == null) return null;
  return `${playersById.get(p1) ?? `#${p1}`} + ${playersById.get(p2) ?? `#${p2}`}`;
};

const bracketPairKey = (p1: number | null, p2: number | null): string | null => {
  if (p1 == null || p2 == null) return null;
  return pairKey(p1, p2);
};

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/login", (req, res) => {
  const body = req.body as { username?: string; password?: string };
  if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Credenciales inválidas." });
    return;
  }
  res.json({ token: ADMIN_TOKEN, user: { username: ADMIN_USERNAME } });
});

app.get("/players", requireAdmin, async (req, res) => {
  const division = requireDivisionFromRequest(req, res);
  if (!division) return;
  const players = await prisma.player.findMany({
    where: { division },
    orderBy: [{ active: "desc" }, { nickname: "asc" }]
  });
  res.json(players);
});

app.post("/players", requireAdmin, async (req, res) => {
  const payload = req.body as { nickname: string; division?: Division };
  const division = parseDivision(payload.division) ?? divisionFromRequest(req);
  if (!division) {
    res.status(400).json({ error: "Parámetro division requerido (men o women)." });
    return;
  }
  const nickname = payload.nickname?.trim();
  if (!nickname) {
    res.status(400).json({ error: "El apodo es obligatorio." });
    return;
  }
  try {
    const player = await prisma.player.create({ data: { nickname, division } });
    res.status(201).json(player);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "El apodo ya existe en este torneo." });
      return;
    }
    throw error;
  }
});

app.put("/players/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const payload = req.body as Partial<{ nickname: string; active: boolean }>;
  if (payload.nickname !== undefined && !payload.nickname.trim()) {
    res.status(400).json({ error: "El apodo es obligatorio." });
    return;
  }
  try {
    const player = await prisma.player.update({
      where: { id },
      data: {
        ...(payload.nickname !== undefined ? { nickname: payload.nickname.trim() } : {}),
        ...(payload.active !== undefined ? { active: payload.active } : {})
      }
    });
    res.json(player);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "El apodo ya existe en este torneo." });
      return;
    }
    throw error;
  }
});

app.delete("/players/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const player = await prisma.player.update({
    where: { id },
    data: { active: false }
  });
  await prisma.blacklistedPlayer.deleteMany({ where: { playerId: id } });
  res.json(player);
});

app.get("/blacklist", requireAdmin, async (req, res) => {
  const division = requireDivisionFromRequest(req, res);
  if (!division) return;
  const entries = await prisma.blacklistedPlayer.findMany({
    where: { player: { division } },
    include: { player: true },
    orderBy: { player: { nickname: "asc" } }
  });
  res.json(entries.map((entry) => entry.player));
});

app.put("/blacklist", requireAdmin, async (req, res) => {
  const division = requireDivisionFromRequest(req, res);
  if (!division) return;
  const body = req.body as { playerIds: number[] };
  const uniqueIds = Array.from(new Set(body.playerIds));
  const mismatch = await assertPlayersMatchDivision(uniqueIds, division);
  if (mismatch) {
    res.status(400).json({ error: mismatch });
    return;
  }

  const divisionPlayerIds = (
    await prisma.player.findMany({
      where: { division },
      select: { id: true }
    })
  ).map((player) => player.id);

  await prisma.$transaction([
    prisma.blacklistedPlayer.deleteMany({ where: { playerId: { in: divisionPlayerIds } } }),
    prisma.blacklistedPlayer.createMany({ data: uniqueIds.map((playerId) => ({ playerId })) })
  ]);

  const entries = await prisma.blacklistedPlayer.findMany({
    where: { player: { division } },
    include: { player: true },
    orderBy: { player: { nickname: "asc" } }
  });

  res.json(entries.map((entry) => entry.player));
});

app.post("/players/:id/partners-history/:otherId", requireAdmin, async (req, res) => {
  const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
  if (a === b) {
    res.status(400).json({ error: "Un jugador no puede cargarse como pareja de sí mismo." });
    return;
  }
  const players = await prisma.player.findMany({
    where: { id: { in: [a, b] } },
    select: { id: true, division: true }
  });
  if (players.length !== 2 || players[0]?.division !== players[1]?.division) {
    res.status(400).json({ error: "Los jugadores deben ser del mismo torneo (hombres o chicas)." });
    return;
  }
  const division = players[0]!.division;
  const existing = await prisma.partnerHistory.findUnique({
    where: { division_playerAId_playerBId: { division, playerAId: a, playerBId: b } }
  });
  if (existing) {
    res.status(200).json({ exists: true, message: "Esa relación ya existe." });
    return;
  }

  const created = await prisma.partnerHistory.create({
    data: { playerAId: a, playerBId: b, division }
  });
  res.status(201).json({ exists: false, message: "Relación agregada.", item: created });
});

app.delete("/players/:id/partners-history/:otherId", requireAdmin, async (req, res) => {
  const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
  const players = await prisma.player.findMany({
    where: { id: { in: [a, b] } },
    select: { division: true }
  });
  if (players.length !== 2 || players[0]?.division !== players[1]?.division) {
    res.status(400).json({ error: "Los jugadores deben ser del mismo torneo." });
    return;
  }
  const division = players[0]!.division;
  await prisma.partnerHistory.delete({
    where: { division_playerAId_playerBId: { division, playerAId: a, playerBId: b } }
  });
  res.status(204).send();
});

app.get("/players/:id/partners-history", requireAdmin, async (req, res) => {
  const playerId = Number(req.params.id);
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { division: true }
  });
  if (!player) {
    res.status(404).json({ error: "Jugador no encontrado." });
    return;
  }
  const [historyRows, players] = await Promise.all([
    prisma.partnerHistory.findMany({
      where: {
        division: player.division,
        OR: [{ playerAId: playerId }, { playerBId: playerId }]
      }
    }),
    prisma.player.findMany({
      where: { division: player.division },
      select: { id: true, nickname: true }
    })
  ]);

  const playersById = new Map(players.map((player) => [player.id, player]));
  const partners = historyRows
    .map((row) => (row.playerAId === playerId ? row.playerBId : row.playerAId))
    .map((id) => playersById.get(id))
    .filter((item): item is { id: number; nickname: string } => Boolean(item))
    .sort((a, b) => a.nickname.localeCompare(b.nickname));

  res.json(partners);
});

app.get("/events", async (req, res) => {
  const division = divisionFromRequest(req);
  const events = await prisma.tournamentEvent.findMany({
    where: division ? { dates: { some: { division } } } : undefined,
    include: {
      dates: {
        where: division ? { division } : undefined,
        include: dateIncludeEvent,
        orderBy: [{ division: "asc" }]
      }
    },
    orderBy: { eventDate: "desc" }
  });
  res.json(events.map(serializeEvent));
});

app.get("/dates", async (req, res) => {
  const division = divisionFromRequest(req);
  const dates = await prisma.tournamentDate.findMany({
    where: division ? { division } : undefined,
    include: dateIncludeEvent,
    orderBy: [{ event: { eventDate: "desc" } }, { id: "desc" }]
  });
  res.json(dates.map(serializeDate));
});

const parseDateOnly = (value: string): Date | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    // Mediodía UTC para que el día de calendario no se corra por timezone.
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

app.post("/events", requireAdmin, async (req, res) => {
  const payload = req.body as { name?: string; eventDate?: string; divisions?: Division[] };
  const name = payload.name?.trim();
  const eventDate = payload.eventDate ? parseDateOnly(payload.eventDate) : null;
  const divisions = parseDivisions(payload.divisions);
  if (!name) {
    res.status(400).json({ error: "El nombre de la fecha es obligatorio." });
    return;
  }
  if (!eventDate) {
    res.status(400).json({ error: "La fecha del día es inválida." });
    return;
  }
  if (divisions.length === 0) {
    res.status(400).json({ error: "Elegí al menos un torneo: hombres y/o chicas." });
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.tournamentEvent.create({ data: { name, eventDate } });
    for (const division of divisions) {
      await tx.tournamentDate.create({
        data: { eventId: event.id, division, status: "OPEN" }
      });
    }
    return tx.tournamentEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: eventIncludeDates
    });
  });

  res.status(201).json(serializeEvent(created));
});

app.post("/events/:eventId/divisions", requireAdmin, async (req, res) => {
  const eventId = Number(req.params.eventId);
  const division = parseDivision((req.body as { division?: Division }).division);
  if (!Number.isFinite(eventId) || !division) {
    res.status(400).json({ error: "Evento o división inválidos." });
    return;
  }
  const event = await prisma.tournamentEvent.findUnique({
    where: { id: eventId },
    include: { dates: true }
  });
  if (!event) {
    res.status(404).json({ error: "Evento no encontrado." });
    return;
  }
  if (event.dates.some((date) => date.division === division)) {
    res.status(409).json({ error: "Ese torneo ya existe en la fecha." });
    return;
  }
  await prisma.tournamentDate.create({
    data: { eventId, division, status: "OPEN" }
  });
  const updated = await prisma.tournamentEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: eventIncludeDates
  });
  res.status(201).json(serializeEvent(updated));
});

app.post("/dates", requireAdmin, async (req, res) => {
  const payload = req.body as { name?: string; eventDate?: string; divisions?: Division[] };
  const divisions = parseDivisions(payload.divisions);
  req.body = {
    name: payload.name,
    eventDate: payload.eventDate,
    divisions: divisions.length > 0 ? divisions : ["MEN"]
  };
  const name = payload.name?.trim();
  const eventDate = payload.eventDate ? parseDateOnly(payload.eventDate) : null;
  if (!name || !eventDate) {
    res.status(400).json({ error: "El nombre y la fecha del día son obligatorios." });
    return;
  }
  const targetDivisions = divisions.length > 0 ? divisions : (["MEN"] as Division[]);
  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.tournamentEvent.create({ data: { name, eventDate } });
    for (const division of targetDivisions) {
      await tx.tournamentDate.create({ data: { eventId: event.id, division, status: "OPEN" } });
    }
    return tx.tournamentEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: eventIncludeDates
    });
  });
  const firstDate = created.dates[0];
  res.status(201).json(firstDate ? serializeDate(firstDate) : serializeEvent(created));
});

app.delete("/dates/:id", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  if (!Number.isFinite(dateId)) {
    res.status(400).json({ error: "ID de fecha inválido." });
    return;
  }

  const date = await prisma.tournamentDate.findUnique({ where: { id: dateId } });
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada." });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.rankingPointEntry.deleteMany({ where: { dateId } });
    await tx.partnerHistory.deleteMany({ where: { dateId } });
    await tx.tournamentDate.delete({ where: { id: dateId } });
    const remaining = await tx.tournamentDate.count({ where: { eventId: date.eventId } });
    if (remaining === 0) {
      await tx.tournamentEvent.delete({ where: { id: date.eventId } });
    }
  });

  res.status(204).send();
});

app.post("/dates/:id/registrations", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    await assertDateEditable(dateId);
    const body = req.body as { playerIds: number[] };
    const data = body.playerIds.map((playerId) => ({ dateId, playerId }));
    await prisma.dateRegistration.createMany({ data, skipDuplicates: true });
    const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
    res.status(201).json(registrations);
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.put("/dates/:id/registrations", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }
    await assertDateEditable(dateId);
    const body = req.body as { playerIds: number[] };
    const uniqueIds = Array.from(new Set(body.playerIds));
    const mismatch = await assertPlayersMatchDivision(uniqueIds, dateRow.division);
    if (mismatch) {
      res.status(400).json({ error: mismatch });
      return;
    }

    await prisma.$transaction([
      prisma.dateRegistration.deleteMany({ where: { dateId } }),
      prisma.dateRegistration.createMany({
        data: uniqueIds.map((playerId) => ({ dateId, playerId }))
      })
    ]);

    const registrations = await prisma.dateRegistration.findMany({
      where: { dateId },
      include: { player: { select: { id: true, nickname: true } } }
    });
    res.json(registrations);
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/seeds", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    await assertDateEditable(dateId);
    const body = req.body as { playerIds: number[] };
    await prisma.dateSeed.deleteMany({ where: { dateId } });
    await prisma.dateSeed.createMany({
      data: body.playerIds.map((playerId, index) => ({
        dateId,
        playerId,
        rank: index + 1
      }))
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/seeds/auto", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }
    await assertDateEditable(dateId);

    const registrations = await prisma.dateRegistration.findMany({
      where: { dateId },
      include: { player: { select: { id: true, nickname: true, active: true, division: true } } }
    });
    const attendees = registrations.map((r) => r.player).filter((p) => p.active && p.division === dateRow.division);
    if (attendees.length < 2 || attendees.length % 2 !== 0) {
      res.status(400).json({ error: "La cantidad de asistentes debe ser par y al menos 2." });
      return;
    }

    const pairCount = attendees.length / 2;
    const zoneSizes = buildZoneSizes(pairCount);
    const n = zoneSizes.length;
    if (n < 1) {
      res.status(400).json({ error: "No se pudieron calcular zonas." });
      return;
    }

    const seasonStarted = await hasAnyRankingPoints(dateRow.division);
    let mode: "random" | "ranking" = "random";
    let seedIds: number[] = [];

    if (!seasonStarted) {
      mode = "random";
      seedIds = shuffle(attendees.map((a) => a.id)).slice(0, n);
    } else {
      mode = "ranking";
      const scores = await getRankingScores(dateRow.division);
      const rankedAttendees = [...attendees].sort((a, b) => {
        const diff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
        if (diff !== 0) return diff;
        return a.nickname.localeCompare(b.nickname);
      });
      seedIds = rankedAttendees.slice(0, n).map((p) => p.id);
    }

    const divisionPlayerIds = (
      await prisma.player.findMany({
        where: { division: dateRow.division },
        select: { id: true }
      })
    ).map((player) => player.id);

    await prisma.$transaction([
      prisma.dateSeed.deleteMany({ where: { dateId } }),
      prisma.dateSeed.createMany({
        data: seedIds.map((playerId, index) => ({
          dateId,
          playerId,
          rank: index + 1
        }))
      }),
      prisma.blacklistedPlayer.deleteMany({ where: { playerId: { in: divisionPlayerIds } } }),
      prisma.blacklistedPlayer.createMany({ data: seedIds.map((playerId) => ({ playerId })) })
    ]);

    const playersById = new Map(attendees.map((p) => [p.id, p.nickname]));
    const zoneByRank = zoneIndexBySeedRank(n);
    res.status(201).json({
      mode,
      zoneCount: n,
      zoneSizes,
      seeds: seedIds.map((playerId, index) => ({
        playerId,
        nickname: playersById.get(playerId) ?? `#${playerId}`,
        rank: index + 1,
        zoneName: `Zona ${String.fromCharCode(65 + zoneByRank[index])}`
      }))
    });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/draw/generate", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }
    await assertDateEditable(dateId);
    const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
    const playerIds = registrations.map((r) => r.playerId);
    if (playerIds.length % 2 !== 0) {
      res.status(400).json({ error: "La cantidad de asistentes debe ser par." });
      return;
    }
    const { blacklist, history } = await getConstraints(dateRow.division);
    const { pairs, conflicts } = generatePairs(shuffle(playerIds), blacklist, history);

    const draw = await prisma.dateDraw.create({
      data: {
        dateId,
        status: "DRAFT",
        pairs: { create: pairs.map(([player1, player2]) => ({ player1, player2 })) }
      },
      include: { pairs: true }
    });

    res.status(201).json({ draw, conflicts });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.put("/dates/:id/draw/manual-adjust", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }
    await assertDateEditable(dateId);
    const body = req.body as { pairs: Array<{ player1: number; player2: number }> };
    const { blacklist, history } = await getConstraints(dateRow.division);
    const errors: string[] = [];

    body.pairs.forEach((pair) => {
      const result = validatePair(pair.player1, pair.player2, blacklist, history);
      if (!result.valid) errors.push(`${pair.player1}-${pair.player2}: ${result.reason}`);
    });

    if (errors.length > 0) {
      res.status(400).json({ ok: false, errors });
      return;
    }

    const existing = await prisma.dateDraw.findFirst({ where: { dateId }, orderBy: { createdAt: "desc" } });
    const draw = existing
      ? await prisma.dateDraw.update({
          where: { id: existing.id },
          data: {
            status: "CONFIRMED",
            pairs: {
              deleteMany: {},
              create: body.pairs.map((pair) => ({
                player1: pair.player1,
                player2: pair.player2
              }))
            }
          },
          include: { pairs: true }
        })
      : await prisma.dateDraw.create({
          data: {
            dateId,
            status: "CONFIRMED",
            pairs: { create: body.pairs.map((pair) => ({ player1: pair.player1, player2: pair.player2 })) }
          },
          include: { pairs: true }
        });

    res.json(draw);
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/zones/generate", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }
    await assertDateEditable(dateId);
    const draw = await prisma.dateDraw.findFirst({
      where: { dateId },
      orderBy: { createdAt: "desc" },
      include: { pairs: true }
    });
    if (!draw) {
      res.status(404).json({ error: "No hay sorteo generado" });
      return;
    }

    const seeds = await prisma.dateSeed.findMany({
      where: { dateId },
      orderBy: [{ rank: "asc" }, { id: "asc" }]
    });
    const seedIds = new Set(seeds.map((s) => s.playerId));
    const seedRankByPlayer = new Map(seeds.map((s) => [s.playerId, s.rank]));
    const blacklistedIds = seedIds.size > 0 ? seedIds : new Set(
      (
        await prisma.blacklistedPlayer.findMany({
          where: { player: { division: dateRow.division } },
          select: { playerId: true }
        })
      ).map((i) => i.playerId)
    );

    type ZonePair = {
      key: string;
      player1: number;
      player2: number;
      seedPlayerId: number | null;
      seedRank: number | null;
      hasBlacklist: boolean;
    };

    const pairs: ZonePair[] = draw.pairs.map((pair) => {
      const seedPlayerId = seedIds.has(pair.player1)
        ? pair.player1
        : seedIds.has(pair.player2)
          ? pair.player2
          : null;
      return {
        key: pairKey(pair.player1, pair.player2),
        player1: pair.player1,
        player2: pair.player2,
        seedPlayerId,
        seedRank: seedPlayerId != null ? (seedRankByPlayer.get(seedPlayerId) ?? null) : null,
        hasBlacklist: blacklistedIds.has(pair.player1) || blacklistedIds.has(pair.player2)
      };
    });

    const zoneSizes = buildZoneSizes(pairs.length);
    const zones = zoneSizes.map((size, index) => ({
      name: `Zona ${String.fromCharCode(65 + index)}`,
      size,
      pairs: [] as ZonePair[]
    }));

    // Cabezas: #1→A, #2→última, #3→B, #4→penúltima... (también en fecha 1 random).
    const orderedSeedPairs = pairs
      .filter((pair) => pair.seedPlayerId != null)
      .sort((a, b) => {
        const rankA = a.seedRank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.seedRank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return a.seedPlayerId! - b.seedPlayerId!;
      });
    const zoneByRank = zoneIndexBySeedRank(zones.length);
    orderedSeedPairs.forEach((pair, index) => {
      const zoneIndex = zoneByRank[index] ?? index;
      if (zones[zoneIndex]) zones[zoneIndex].pairs.push(pair);
    });

    const seededKeys = new Set(zones.flatMap((zone) => zone.pairs.map((pair) => pair.key)));
    const remainingPairs = shuffle(pairs.filter((pair) => !seededKeys.has(pair.key)));

    remainingPairs.forEach((pair) => {
      const candidates = zones
        .filter((zone) => zone.pairs.length < zone.size)
        .sort((a, b) => {
          const aHasBlacklisted = a.pairs.some((item) => item.hasBlacklist);
          const bHasBlacklisted = b.pairs.some((item) => item.hasBlacklist);
          const aPenalty = pair.hasBlacklist && aHasBlacklisted ? 100 : 0;
          const bPenalty = pair.hasBlacklist && bHasBlacklisted ? 100 : 0;
          if (aPenalty !== bPenalty) return aPenalty - bPenalty;
          return a.pairs.length - b.pairs.length;
        });
      if (candidates[0]) candidates[0].pairs.push(pair);
    });

    await prisma.zoneMatch.deleteMany({ where: { dateId } });
    await prisma.zone.deleteMany({ where: { dateId } });
    await prisma.bracketMatch.deleteMany({ where: { dateId } });

    for (const zoneData of zones) {
      await prisma.zone.create({
        data: { dateId, name: zoneData.name, size: zoneData.pairs.length }
      });

      for (let i = 0; i < zoneData.pairs.length; i += 1) {
        for (let j = i + 1; j < zoneData.pairs.length; j += 1) {
          const pairA = zoneData.pairs[i];
          const pairB = zoneData.pairs[j];
          await prisma.zoneMatch.create({
            data: {
              dateId,
              zoneName: zoneData.name,
              pairAPlayer1: pairA.player1,
              pairAPlayer2: pairA.player2,
              pairBPlayer1: pairB.player1,
              pairBPlayer2: pairB.player2,
              score: null,
              winnerPairKey: null
            }
          });
        }
      }
    }

    const zoneViews = await buildZonesComputed(dateId);
    res.status(201).json(zoneViews);
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.put("/dates/:dateId/zones/matches/:matchId", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.dateId);
    await assertDateEditable(dateId);
    const matchId = Number(req.params.matchId);
    const body = req.body as { winnerPairKey: string | null; score?: string | null };

    const match = await prisma.zoneMatch.findUnique({ where: { id: matchId } });
    if (!match || match.dateId !== dateId) {
      res.status(404).json({ error: "Partido de zona no encontrado." });
      return;
    }

    const validWinnerKeys = [pairKey(match.pairAPlayer1, match.pairAPlayer2), pairKey(match.pairBPlayer1, match.pairBPlayer2)];
    if (body.winnerPairKey !== null && !validWinnerKeys.includes(body.winnerPairKey)) {
      res.status(400).json({ error: "Ganador inválido para este partido." });
      return;
    }

    if (body.winnerPairKey && body.score != null && body.score.trim() === "") {
      res.status(400).json({ error: "El marcador es obligatorio para clasificar la zona." });
      return;
    }
    if (body.score && body.score.trim() && !isValidSetScore(body.score)) {
      res.status(400).json({
        error: "Marcador inválido. Usá un solo set (ej: 6-2). Si hay un 7, el otro debe ser 5 o 6."
      });
      return;
    }

    const updated = await prisma.zoneMatch.update({
      where: { id: matchId },
      data: {
        winnerPairKey: body.winnerPairKey,
        score: body.score?.trim() || null
      }
    });

    res.json(updated);
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/bracket/generate", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    await assertDateEditable(dateId);
    const zonesComputed = await buildZonesComputed(dateId);
    if (zonesComputed.length === 0) {
      res.status(400).json({ error: "Primero generá las zonas y cargá resultados." });
      return;
    }

    const unfinished = zonesComputed.some((zone) => zone.matches.some((m) => !m.winnerPairKey));
    if (unfinished) {
      res.status(400).json({ error: "Completá todos los partidos de zona antes de armar el cuadro." });
      return;
    }

    const pairCount = zonesComputed.reduce((sum, zone) => sum + zone.pairs.length, 0);
    const template = getBracketTemplate(pairCount);
    if (!template) {
      res.status(400).json({
        error: `No hay plantilla de cuadro para ${pairCount} parejas. Usá 14–18 parejas.`
      });
      return;
    }

    const lookup = new Map<string, ResolvedPair>();
    zonesComputed.forEach((zone, zoneIndex) => {
      zone.qualifiers.forEach((q) => {
        lookup.set(qualifierKey({ zone: zoneIndex + 1, place: q.place }), {
          player1: q.player1,
          player2: q.player2,
          key: q.key
        });
      });
    });

    let r1Matchups: Array<[ResolvedPair | null, ResolvedPair | null]>;
    try {
      r1Matchups = resolveRound1Matchups(template, lookup);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo armar el cuadro con la plantilla.";
      res.status(400).json({ error: message });
      return;
    }

    await prisma.bracketMatch.deleteMany({ where: { dateId } });

    const firstRoundMatches = r1Matchups.map((matchup, index) => ({
      dateId,
      round: 1,
      position: index + 1,
      pairAPlayer1: matchup[0]?.player1 ?? null,
      pairAPlayer2: matchup[0]?.player2 ?? null,
      pairBPlayer1: matchup[1]?.player1 ?? null,
      pairBPlayer2: matchup[1]?.player2 ?? null
    }));

    await prisma.bracketMatch.createMany({ data: firstRoundMatches });

    let matchesInRound = firstRoundMatches.length;
    let round = 2;
    while (matchesInRound > 1) {
      const roundMatches = Array.from({ length: Math.floor(matchesInRound / 2) }, (_, index) => ({
        dateId,
        round,
        position: index + 1,
        pairAPlayer1: null as number | null,
        pairAPlayer2: null as number | null,
        pairBPlayer1: null as number | null,
        pairBPlayer2: null as number | null
      }));
      await prisma.bracketMatch.createMany({ data: roundMatches });
      matchesInRound = roundMatches.length;
      round += 1;
    }

    const round1 = await prisma.bracketMatch.findMany({ where: { dateId, round: 1 } });
    for (const match of round1) {
      const aOk = match.pairAPlayer1 != null && match.pairAPlayer2 != null;
      const bOk = match.pairBPlayer1 != null && match.pairBPlayer2 != null;
      if (aOk && !bOk) {
        const winnerKey = pairKey(match.pairAPlayer1!, match.pairAPlayer2!);
        await prisma.bracketMatch.update({
          where: { id: match.id },
          data: { winnerPairKey: winnerKey, score: "BYE" }
        });
        await advanceWinner(dateId, match.round, match.position, match.pairAPlayer1!, match.pairAPlayer2!);
      } else if (!aOk && bOk) {
        const winnerKey = pairKey(match.pairBPlayer1!, match.pairBPlayer2!);
        await prisma.bracketMatch.update({
          where: { id: match.id },
          data: { winnerPairKey: winnerKey, score: "BYE" }
        });
        await advanceWinner(dateId, match.round, match.position, match.pairBPlayer1!, match.pairBPlayer2!);
      }
    }

    const bracket = await prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    });
    res.status(201).json({
      template: pairCount,
      hasTemplate: hasBracketTemplate(pairCount),
      bracket
    });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

async function advanceWinner(
  dateId: number,
  round: number,
  position: number,
  player1: number,
  player2: number
) {
  const nextRound = round + 1;
  const nextPosition = Math.ceil(position / 2);
  const nextMatch = await prisma.bracketMatch.findUnique({
    where: { dateId_round_position: { dateId, round: nextRound, position: nextPosition } }
  });
  if (!nextMatch) return;

  const goesToA = position % 2 === 1;
  await prisma.bracketMatch.update({
    where: { id: nextMatch.id },
    data: goesToA
      ? { pairAPlayer1: player1, pairAPlayer2: player2, winnerPairKey: null, score: null }
      : { pairBPlayer1: player1, pairBPlayer2: player2, winnerPairKey: null, score: null }
  });
}

app.put("/dates/:dateId/bracket/matches/:matchId", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.dateId);
    await assertDateEditable(dateId);
    const matchId = Number(req.params.matchId);
    const body = req.body as { winnerPairKey: string | null; score?: string | null };

    const match = await prisma.bracketMatch.findUnique({ where: { id: matchId } });
    if (!match || match.dateId !== dateId) {
      res.status(404).json({ error: "Partido de cuadro no encontrado." });
      return;
    }

    const keyA = bracketPairKey(match.pairAPlayer1, match.pairAPlayer2);
    const keyB = bracketPairKey(match.pairBPlayer1, match.pairBPlayer2);
    const validKeys = [keyA, keyB].filter(Boolean) as string[];

    if (body.winnerPairKey !== null && !validKeys.includes(body.winnerPairKey)) {
      res.status(400).json({ error: "Ganador inválido para este partido." });
      return;
    }

    if (body.winnerPairKey && (!body.score || !body.score.trim())) {
      res.status(400).json({ error: "El marcador es obligatorio." });
      return;
    }
    if (body.score && body.score.trim() && body.score.trim().toUpperCase() !== "BYE" && !isValidSetScore(body.score)) {
      res.status(400).json({
        error: "Marcador inválido. Usá un solo set (ej: 6-2). Si hay un 7, el otro debe ser 5 o 6."
      });
      return;
    }

    const updated = await prisma.bracketMatch.update({
      where: { id: match.id },
      data: {
        winnerPairKey: body.winnerPairKey,
        score: body.score?.trim() || null
      }
    });

    if (body.winnerPairKey && keyA && body.winnerPairKey === keyA) {
      await advanceWinner(dateId, match.round, match.position, match.pairAPlayer1!, match.pairAPlayer2!);
    } else if (body.winnerPairKey && keyB && body.winnerPairKey === keyB) {
      await advanceWinner(dateId, match.round, match.position, match.pairBPlayer1!, match.pairBPlayer2!);
    }

    const bracket = await prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    });
    res.json({ match: updated, bracket });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.post("/dates/:id/close", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    const date = await assertDateEditable(dateId);
    const dateRow = await loadDateWithEvent(dateId);
    if (!dateRow) {
      res.status(404).json({ error: "Fecha no encontrada." });
      return;
    }

    const [draw, bracket] = await Promise.all([
      prisma.dateDraw.findFirst({
        where: { dateId },
        orderBy: { createdAt: "desc" },
        include: { pairs: true }
      }),
      prisma.bracketMatch.findMany({ where: { dateId } })
    ]);

    if (!draw || draw.pairs.length === 0) {
      res.status(400).json({ error: "No hay sorteo para cerrar la fecha." });
      return;
    }

    const unfinishedBracket = bracket.filter((m) => {
      const aOk = m.pairAPlayer1 != null && m.pairAPlayer2 != null;
      const bOk = m.pairBPlayer1 != null && m.pairBPlayer2 != null;
      return aOk && bOk && !m.winnerPairKey;
    });
    if (bracket.length > 0 && unfinishedBracket.length > 0) {
      res.status(400).json({ error: "Completá todos los partidos del cuadro antes de cerrar." });
      return;
    }

    const assignments = computeStageAssignments(bracket, pairKey);

    const firstSeasonDate = await prisma.tournamentDate.findFirst({
      where: { division: dateRow.division },
      orderBy: [{ event: { eventDate: "asc" } }, { id: "asc" }]
    });
    const isDoublePoints = firstSeasonDate?.id === dateId;
    const pointsMultiplier = isDoublePoints ? 2 : 1;
    const eventLabel = dateRow.event.name;

    await prisma.$transaction(async (tx) => {
      await tx.rankingPointEntry.deleteMany({ where: { dateId, manual: false } });
      await tx.partnerHistory.deleteMany({ where: { dateId } });

      if (assignments.size > 0) {
        await tx.rankingPointEntry.createMany({
          data: Array.from(assignments.entries()).map(([playerId, stage]) => ({
            playerId,
            dateId,
            points: STAGE_POINTS[stage] * pointsMultiplier,
            reason: `${eventLabel} - ${stage}${isDoublePoints ? " (x2 primera fecha)" : ""}`,
            manual: false
          }))
        });
      }

      await tx.partnerHistory.createMany({
        data: draw.pairs.map((pair) => {
          const [a, b] = normalizePair(pair.player1, pair.player2);
          return { playerAId: a, playerBId: b, dateId, division: dateRow.division };
        }),
        skipDuplicates: true
      });

      await tx.tournamentDate.update({
        where: { id: dateId },
        data: {
          status: "CLOSED",
          closedAt: date.status === "CLOSED" && date.closedAt ? date.closedAt : new Date()
        }
      });
    });

    const updated = await loadDateWithEvent(dateId);
    res.json({
      date: updated ? serializeDate(updated) : null,
      editableUntil: updated ? editableUntil(updated) : null,
      doublePoints: isDoublePoints,
      assignments: Array.from(assignments.entries()).map(([playerId, stage]) => ({
        playerId,
        stage,
        points: STAGE_POINTS[stage] * pointsMultiplier
      }))
    });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.get("/dates/:id/workspace", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const date = await loadDateWithEvent(dateId);
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada" });
    return;
  }

  const [registrations, seeds, draw, zones, players, bracket, zonesComputed] = await Promise.all([
    prisma.dateRegistration.findMany({
      where: { dateId },
      include: { player: { select: { id: true, nickname: true } } }
    }),
    prisma.dateSeed.findMany({
      where: { dateId },
      orderBy: [{ rank: "asc" }, { id: "asc" }]
    }),
    prisma.dateDraw.findFirst({
      where: { dateId },
      orderBy: { createdAt: "desc" },
      include: { pairs: true }
    }),
    prisma.zone.findMany({ where: { dateId }, orderBy: { name: "asc" } }),
    prisma.player.findMany({
      where: { division: date.division },
      select: { id: true, nickname: true }
    }),
    prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    }),
    buildZonesComputed(dateId)
  ]);

  const playersById = new Map(players.map((player) => [player.id, player.nickname]));
  const pairsWithNames =
    draw?.pairs.map((pair) => ({
      ...pair,
      player1Nickname: playersById.get(pair.player1) ?? `#${pair.player1}`,
      player2Nickname: playersById.get(pair.player2) ?? `#${pair.player2}`
    })) ?? [];

  const bracketWithNames = bracket.map((match) => ({
    ...match,
    pairA: pairLabel(match.pairAPlayer1, match.pairAPlayer2, playersById),
    pairB: pairLabel(match.pairBPlayer1, match.pairBPlayer2, playersById),
    pairAKey: bracketPairKey(match.pairAPlayer1, match.pairAPlayer2),
    pairBKey: bracketPairKey(match.pairBPlayer1, match.pairBPlayer2)
  }));

  res.json({
    date: serializeDate(date),
    locked: isDateLocked(date),
    editableUntil: editableUntil(date),
    registrations: registrations.map((item) => item.player),
    seeds: (() => {
      const zoneByRank = zoneIndexBySeedRank(seeds.length);
      return seeds.map((seed, index) => ({
        playerId: seed.playerId,
        nickname: playersById.get(seed.playerId) ?? `#${seed.playerId}`,
        rank: seed.rank,
        zoneName: `Zona ${String.fromCharCode(65 + (zoneByRank[index] ?? index))}`
      }));
    })(),
    draw: draw ? { ...draw, pairs: pairsWithNames } : null,
    zones,
    bracket: bracketWithNames,
    zonesComputed
  });
});

app.post("/dates/:id/results", requireAdmin, async (req, res) => {
  try {
    const dateId = Number(req.params.id);
    await assertDateEditable(dateId);
    const body = req.body as {
      assignments: Array<{ playerId: number; stage: Stage }>;
      manualAdjustments?: Array<{ playerId: number; points: number; reason: string }>;
    };

    await prisma.rankingPointEntry.createMany({
      data: body.assignments.map((item) => ({
        playerId: item.playerId,
        dateId,
        points: STAGE_POINTS[item.stage],
        reason: `Fecha ${dateId} - ${item.stage}`,
        manual: false
      }))
    });

    if (body.manualAdjustments?.length) {
      await prisma.rankingPointEntry.createMany({
        data: body.manualAdjustments.map((item) => ({
          playerId: item.playerId,
          dateId,
          points: item.points,
          reason: item.reason,
          manual: true
        }))
      });
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    if (handleDateGuardError(error, res)) return;
    throw error;
  }
});

app.get("/ranking", async (req, res) => {
  const division = requireDivisionFromRequest(req, res, "MEN");
  if (!division) return;
  const players = await prisma.player.findMany({
    include: { pointsEntries: true },
    where: { active: true, division }
  });
  const ranking = players
    .map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      points: player.pointsEntries.reduce((sum, item) => sum + item.points, 0)
    }))
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points);

  res.json(ranking);
});

app.post("/ranking/manual-adjustment", requireAdmin, async (req, res) => {
  const body = req.body as { playerId: number; points: number; reason: string };
  const entry = await prisma.rankingPointEntry.create({
    data: { playerId: body.playerId, points: body.points, reason: body.reason, manual: true }
  });
  res.status(201).json(entry);
});

app.post("/ranking/manual-adjustments", requireAdmin, async (req, res) => {
  const body = req.body as { items: Array<{ playerId: number; points: number; reason: string }> };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "Debes enviar al menos un ajuste manual." });
    return;
  }

  const created = await prisma.$transaction(
    body.items.map((item) =>
      prisma.rankingPointEntry.create({
        data: {
          playerId: item.playerId,
          points: item.points,
          reason: item.reason,
          manual: true
        }
      })
    )
  );

  res.status(201).json(created);
});

app.get("/ranking/ledger", requireAdmin, async (req, res) => {
  const division = divisionFromRequest(req);
  const entries = await prisma.rankingPointEntry.findMany({
    where: division ? { player: { division } } : undefined,
    include: { player: { select: { id: true, nickname: true, division: true } } },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  res.json(entries);
});

app.get("/public/overview", async (req, res) => {
  const division = requireDivisionFromRequest(req, res, "MEN");
  if (!division) return;
  const [ranking, dates] = await Promise.all([
    prisma.player.findMany({ include: { pointsEntries: true }, where: { active: true, division } }),
    prisma.tournamentDate.findMany({
      where: { division },
      include: dateIncludeEvent,
      orderBy: [{ event: { eventDate: "desc" } }, { id: "desc" }],
      take: 3
    })
  ]);

  res.json({
    ranking: ranking
      .map((p) => ({
        playerId: p.id,
        nickname: p.nickname,
        points: p.pointsEntries.reduce((sum, item) => sum + item.points, 0)
      }))
      .filter((row) => row.points > 0)
      .sort((a, b) => b.points - a.points),
    dates: dates.map(serializeDate)
  });
});

app.get("/public/events", async (req, res) => {
  const division = divisionFromRequest(req);
  const events = await prisma.tournamentEvent.findMany({
    where: division ? { dates: { some: { division } } } : undefined,
    include: {
      dates: {
        where: division ? { division } : undefined,
        include: dateIncludeEvent,
        orderBy: [{ division: "asc" }]
      }
    },
    orderBy: { eventDate: "desc" }
  });
  res.json(events.map(serializeEvent));
});

app.get("/public/dates", async (req, res) => {
  const division = divisionFromRequest(req);
  const dates = await prisma.tournamentDate.findMany({
    where: division ? { division } : undefined,
    include: dateIncludeEvent,
    orderBy: [{ event: { eventDate: "desc" } }, { id: "desc" }]
  });
  res.json(dates.map(serializeDate));
});

app.get("/public/dates/:id/bracket", async (req, res) => {
  const dateId = Number(req.params.id);
  const date = await loadDateWithEvent(dateId);
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada." });
    return;
  }
  const [bracket, players] = await Promise.all([
    prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    }),
    prisma.player.findMany({
      where: { division: date.division },
      select: { id: true, nickname: true }
    })
  ]);
  const playersById = new Map(players.map((player) => [player.id, player.nickname]));
  const withNames = bracket.map((match) => ({
    ...match,
    pairA: pairLabel(match.pairAPlayer1, match.pairAPlayer2, playersById) ?? "BYE",
    pairB: pairLabel(match.pairBPlayer1, match.pairBPlayer2, playersById) ?? "BYE",
    pairAKey: bracketPairKey(match.pairAPlayer1, match.pairAPlayer2),
    pairBKey: bracketPairKey(match.pairBPlayer1, match.pairBPlayer2)
  }));

  res.json({ date: serializeDate(date), bracket: withNames });
});

app.get("/public/dates/:id/zones", async (req, res) => {
  const dateId = Number(req.params.id);
  const date = await loadDateWithEvent(dateId);
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada." });
    return;
  }
  const zonesComputed = await buildZonesComputed(dateId);
  res.json({ date: serializeDate(date), zones: zonesComputed });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
