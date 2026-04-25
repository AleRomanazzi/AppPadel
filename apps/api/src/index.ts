import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { generatePairs, normalizePair, pairKey, validatePair } from "./pairing.js";

type Stage = "OCTAVOS" | "CUARTOS" | "SEMIS" | "SUBCAMPEON" | "CAMPEON";
const STAGE_POINTS: Record<Stage, number> = {
  OCTAVOS: 15,
  CUARTOS: 25,
  SEMIS: 50,
  SUBCAMPEON: 75,
  CAMPEON: 100
};

const app = express();
app.use(helmet());
app.use(cors());
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

const getConstraints = async () => {
  const [blacklistedPlayers, historyPairs] = await Promise.all([
    prisma.blacklistedPlayer.findMany(),
    prisma.partnerHistory.findMany()
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

const nextPowerOfTwo = (value: number): number => {
  let power = 1;
  while (power < value) power *= 2;
  return power;
};

const shuffle = <T,>(items: T[]): T[] => {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

const buildZoneSizes = (pairCount: number): number[] => {
  for (let zonesOf4 = 0; zonesOf4 <= Math.ceil(pairCount / 4); zonesOf4 += 1) {
    const remaining = pairCount - zonesOf4 * 4;
    if (remaining >= 0 && remaining % 3 === 0) {
      const zonesOf3 = remaining / 3;
      return [...Array.from({ length: zonesOf4 }, () => 4), ...Array.from({ length: zonesOf3 }, () => 3)];
    }
  }
  const fallback: number[] = [];
  let left = pairCount;
  while (left > 4) {
    fallback.push(4);
    left -= 4;
  }
  if (left > 0) fallback.push(left);
  return fallback;
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

const buildZonesComputed = async (dateId: number): Promise<ZoneComputed[]> => {
  const [zones, matches, players] = await Promise.all([
    prisma.zone.findMany({ where: { dateId }, orderBy: { name: "asc" } }),
    prisma.zoneMatch.findMany({ where: { dateId }, orderBy: { id: "asc" } }),
    prisma.player.findMany({ select: { id: true, nickname: true } })
  ]);

  const playersById = new Map(players.map((player) => [player.id, player.nickname]));

  return zones.map((zone) => {
    const zoneMatches = matches.filter((match) => match.zoneName === zone.name);
    const pairsMap = new Map<string, { key: string; label: string; player1: number; player2: number; wins: number; played: number }>();

    const ensurePair = (p1: number, p2: number) => {
      const key = pairKey(p1, p2);
      if (!pairsMap.has(key)) {
        pairsMap.set(key, {
          key,
          label: `${playersById.get(p1) ?? `#${p1}`} + ${playersById.get(p2) ?? `#${p2}`}`,
          player1: p1,
          player2: p2,
          wins: 0,
          played: 0
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
    });

    const sortedPairs = Array.from(pairsMap.values()).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.played !== b.played) return a.played - b.played;
      return a.label.localeCompare(b.label);
    });

    return {
      id: zone.id,
      name: zone.name,
      pairs: sortedPairs,
      matches: normalizedMatches,
      qualifiers: sortedPairs.slice(0, 2).map((pair) => ({
        key: pair.key,
        label: pair.label,
        player1: pair.player1,
        player2: pair.player2
      }))
    };
  });
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

app.get("/players", requireAdmin, async (_req, res) => {
  const players = await prisma.player.findMany({ orderBy: { id: "asc" } });
  res.json(players);
});

app.post("/players", requireAdmin, async (req, res) => {
  const payload = req.body as { nickname: string };
  const nickname = payload.nickname?.trim();
  if (!nickname) {
    res.status(400).json({ error: "El apodo es obligatorio." });
    return;
  }
  try {
    const player = await prisma.player.create({ data: { nickname } });
    res.status(201).json(player);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "El apodo ya existe. Debe ser irrepetible." });
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
      data: { ...payload, nickname: payload.nickname?.trim() }
    });
    res.json(player);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "El apodo ya existe. Debe ser irrepetible." });
      return;
    }
    throw error;
  }
});

app.get("/blacklist", requireAdmin, async (_req, res) => {
  const entries = await prisma.blacklistedPlayer.findMany({
    include: { player: true },
    orderBy: { player: { nickname: "asc" } }
  });
  res.json(entries.map((entry) => entry.player));
});

app.put("/blacklist", requireAdmin, async (req, res) => {
  const body = req.body as { playerIds: number[] };
  const uniqueIds = Array.from(new Set(body.playerIds));

  await prisma.$transaction([
    prisma.blacklistedPlayer.deleteMany({}),
    prisma.blacklistedPlayer.createMany({ data: uniqueIds.map((playerId) => ({ playerId })) })
  ]);

  const entries = await prisma.blacklistedPlayer.findMany({
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
  const existing = await prisma.partnerHistory.findUnique({
    where: { playerAId_playerBId: { playerAId: a, playerBId: b } }
  });
  if (existing) {
    res.status(200).json({ exists: true, message: "Esa relación ya existe." });
    return;
  }

  const created = await prisma.partnerHistory.create({
    data: { playerAId: a, playerBId: b }
  });
  res.status(201).json({ exists: false, message: "Relación agregada.", item: created });
});

app.delete("/players/:id/partners-history/:otherId", requireAdmin, async (req, res) => {
  const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
  await prisma.partnerHistory.delete({ where: { playerAId_playerBId: { playerAId: a, playerBId: b } } });
  res.status(204).send();
});

app.get("/players/:id/partners-history", requireAdmin, async (req, res) => {
  const playerId = Number(req.params.id);
  const [historyRows, players] = await Promise.all([
    prisma.partnerHistory.findMany({
      where: {
        OR: [{ playerAId: playerId }, { playerBId: playerId }]
      }
    }),
    prisma.player.findMany({ select: { id: true, nickname: true } })
  ]);

  const playersById = new Map(players.map((player) => [player.id, player]));
  const partners = historyRows
    .map((row) => (row.playerAId === playerId ? row.playerBId : row.playerAId))
    .map((id) => playersById.get(id))
    .filter((item): item is { id: number; nickname: string } => Boolean(item))
    .sort((a, b) => a.nickname.localeCompare(b.nickname));

  res.json(partners);
});

app.get("/dates", async (_req, res) => {
  const dates = await prisma.tournamentDate.findMany({ orderBy: { eventDate: "desc" } });
  res.json(dates);
});

app.post("/dates", requireAdmin, async (req, res) => {
  const payload = req.body as { name: string; eventDate: string };
  const created = await prisma.tournamentDate.create({
    data: { name: payload.name, eventDate: new Date(payload.eventDate) }
  });
  res.status(201).json(created);
});

app.post("/dates/:id/registrations", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const body = req.body as { playerIds: number[] };
  const data = body.playerIds.map((playerId) => ({ dateId, playerId }));
  await prisma.dateRegistration.createMany({ data, skipDuplicates: true });
  const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
  res.status(201).json(registrations);
});

app.put("/dates/:id/registrations", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const body = req.body as { playerIds: number[] };
  const uniqueIds = Array.from(new Set(body.playerIds));

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
});

app.post("/dates/:id/seeds", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const body = req.body as { playerIds: number[] };
  await prisma.dateSeed.deleteMany({ where: { dateId } });
  await prisma.dateSeed.createMany({
    data: body.playerIds.slice(0, 4).map((playerId) => ({ dateId, playerId }))
  });
  res.status(201).json({ ok: true });
});

app.post("/dates/:id/draw/generate", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
  const playerIds = registrations.map((r) => r.playerId);
  const { blacklist, history } = await getConstraints();
  const { pairs, conflicts } = generatePairs(playerIds, blacklist, history);

  const draw = await prisma.dateDraw.create({
    data: {
      dateId,
      status: "DRAFT",
      pairs: { create: pairs.map(([player1, player2]) => ({ player1, player2 })) }
    },
    include: { pairs: true }
  });

  res.status(201).json({ draw, conflicts });
});

app.put("/dates/:id/draw/manual-adjust", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const body = req.body as { pairs: Array<{ player1: number; player2: number }> };
  const { blacklist, history } = await getConstraints();
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

  await prisma.partnerHistory.createMany({
    data: body.pairs.map((pair) => {
      const [a, b] = normalizePair(pair.player1, pair.player2);
      return { playerAId: a, playerBId: b, dateId };
    }),
    skipDuplicates: true
  });

  res.json(draw);
});

app.post("/dates/:id/zones/generate", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const draw = await prisma.dateDraw.findFirst({
    where: { dateId },
    orderBy: { createdAt: "desc" },
    include: { pairs: true }
  });
  if (!draw) {
    res.status(404).json({ error: "No hay sorteo generado" });
    return;
  }

  const blacklist = await prisma.blacklistedPlayer.findMany({ select: { playerId: true } });
  const blacklistedIds = new Set(blacklist.map((item) => item.playerId));

  const pairs = draw.pairs.map((pair) => {
    const key = pairKey(pair.player1, pair.player2);
    const hasBlacklist = blacklistedIds.has(pair.player1) || blacklistedIds.has(pair.player2);
    return { key, player1: pair.player1, player2: pair.player2, hasBlacklist };
  });

  const zoneSizes = buildZoneSizes(pairs.length);
  const zones = zoneSizes.map((size, index) => ({
    name: `Zona ${String.fromCharCode(65 + index)}`,
    size,
    pairs: [] as typeof pairs
  }));

  const seedCandidates = shuffle(pairs.filter((pair) => pair.hasBlacklist));
  zones.forEach((zone, index) => {
    if (seedCandidates[index]) {
      zone.pairs.push(seedCandidates[index]);
    }
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
});

app.put("/dates/:dateId/zones/matches/:matchId", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.dateId);
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

  const updated = await prisma.zoneMatch.update({
    where: { id: matchId },
    data: {
      winnerPairKey: body.winnerPairKey,
      score: body.score ?? null
    }
  });

  res.json(updated);
});

app.post("/dates/:id/bracket/generate", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const zonesComputed = await buildZonesComputed(dateId);
  const qualifiers = zonesComputed.flatMap((zone) =>
    zone.qualifiers.map((pair) => ({
      pairAPlayer1: pair.player1,
      pairAPlayer2: pair.player2
    }))
  );

  let pairs = qualifiers;
  if (pairs.length < 2) {
    const draw = await prisma.dateDraw.findFirst({
      where: { dateId },
      orderBy: { createdAt: "desc" },
      include: { pairs: true }
    });
    if (!draw || draw.pairs.length === 0) {
      res.status(400).json({ error: "No hay parejas sorteadas para armar cuadro." });
      return;
    }
    pairs = draw.pairs.map((pair) => ({
      pairAPlayer1: pair.player1,
      pairAPlayer2: pair.player2
    }));
  }

  const bracketSize = nextPowerOfTwo(pairs.length);
  const byesNeeded = bracketSize - pairs.length;
  const paddedPairs = [...pairs, ...Array.from({ length: byesNeeded }, () => ({ pairAPlayer1: null, pairAPlayer2: null }))];

  await prisma.bracketMatch.deleteMany({ where: { dateId } });

  const firstRoundMatches = [];
  for (let i = 0; i < paddedPairs.length; i += 2) {
    firstRoundMatches.push({
      dateId,
      round: 1,
      position: i / 2 + 1,
      pairAPlayer1: paddedPairs[i].pairAPlayer1,
      pairAPlayer2: paddedPairs[i].pairAPlayer2,
      pairBPlayer1: paddedPairs[i + 1]?.pairAPlayer1 ?? null,
      pairBPlayer2: paddedPairs[i + 1]?.pairAPlayer2 ?? null
    });
  }

  await prisma.bracketMatch.createMany({ data: firstRoundMatches });

  let matchesInRound = firstRoundMatches.length;
  let round = 2;
  while (matchesInRound > 1) {
    const roundMatches = Array.from({ length: Math.floor(matchesInRound / 2) }, (_, index) => ({
      dateId,
      round,
      position: index + 1,
      pairAPlayer1: null,
      pairAPlayer2: null,
      pairBPlayer1: null,
      pairBPlayer2: null
    }));
    await prisma.bracketMatch.createMany({ data: roundMatches });
    matchesInRound = roundMatches.length;
    round += 1;
  }

  const bracket = await prisma.bracketMatch.findMany({
    where: { dateId },
    orderBy: [{ round: "asc" }, { position: "asc" }]
  });
  res.status(201).json(bracket);
});

app.get("/dates/:id/workspace", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const [date, registrations, seeds, draw, zones, players, bracket, zonesComputed] = await Promise.all([
    prisma.tournamentDate.findUnique({ where: { id: dateId } }),
    prisma.dateRegistration.findMany({
      where: { dateId },
      include: { player: { select: { id: true, nickname: true } } }
    }),
    prisma.dateSeed.findMany({
      where: { dateId }
    }),
    prisma.dateDraw.findFirst({
      where: { dateId },
      orderBy: { createdAt: "desc" },
      include: { pairs: true }
    }),
    prisma.zone.findMany({ where: { dateId }, orderBy: { name: "asc" } }),
    prisma.player.findMany({ select: { id: true, nickname: true } }),
    prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    }),
    buildZonesComputed(dateId)
  ]);

  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada" });
    return;
  }

  const playersById = new Map(players.map((player) => [player.id, player.nickname]));
  const pairsWithNames =
    draw?.pairs.map((pair) => ({
      ...pair,
      player1Nickname: playersById.get(pair.player1) ?? `#${pair.player1}`,
      player2Nickname: playersById.get(pair.player2) ?? `#${pair.player2}`
    })) ?? [];

  res.json({
    date,
    registrations: registrations.map((item) => item.player),
    seeds: seeds.map((seed) => ({
      playerId: seed.playerId,
      nickname: playersById.get(seed.playerId) ?? `#${seed.playerId}`
    })),
    draw: draw ? { ...draw, pairs: pairsWithNames } : null,
    zones,
    bracket,
    zonesComputed
  });
});

app.post("/dates/:id/results", requireAdmin, async (req, res) => {
  const dateId = Number(req.params.id);
  const body = req.body as {
    assignments: Array<{ playerId: number; stage: Stage }>;
    manualAdjustments?: Array<{ playerId: number; points: number; reason: string }>;
  };

  await prisma.rankingPointEntry.createMany({
    data: body.assignments.map((item) => ({
      playerId: item.playerId,
      points: STAGE_POINTS[item.stage],
      reason: `Fecha ${dateId} - ${item.stage}`,
      manual: false
    }))
  });

  if (body.manualAdjustments?.length) {
    await prisma.rankingPointEntry.createMany({
      data: body.manualAdjustments.map((item) => ({
        playerId: item.playerId,
        points: item.points,
        reason: item.reason,
        manual: true
      }))
    });
  }

  res.status(201).json({ ok: true });
});

app.get("/ranking", async (_req, res) => {
  const players = await prisma.player.findMany({
    include: { pointsEntries: true },
    where: { active: true }
  });
  const ranking = players
    .map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      points: player.pointsEntries.reduce((sum, item) => sum + item.points, 0)
    }))
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

app.get("/ranking/ledger", requireAdmin, async (_req, res) => {
  const entries = await prisma.rankingPointEntry.findMany({
    include: { player: { select: { id: true, nickname: true } } },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  res.json(entries);
});

app.get("/public/overview", async (_req, res) => {
  const [ranking, dates] = await Promise.all([
    prisma.player.findMany({ include: { pointsEntries: true }, where: { active: true } }),
    prisma.tournamentDate.findMany({ orderBy: { eventDate: "desc" }, take: 3 })
  ]);

  res.json({
    ranking: ranking
      .map((p) => ({
        playerId: p.id,
        nickname: p.nickname,
        points: p.pointsEntries.reduce((sum, item) => sum + item.points, 0)
      }))
      .sort((a, b) => b.points - a.points),
    dates
  });
});

app.get("/public/dates", async (_req, res) => {
  const dates = await prisma.tournamentDate.findMany({
    orderBy: { eventDate: "desc" },
    select: { id: true, name: true, eventDate: true, status: true }
  });
  res.json(dates);
});

app.get("/public/dates/:id/bracket", async (req, res) => {
  const dateId = Number(req.params.id);
  const [date, bracket, players] = await Promise.all([
    prisma.tournamentDate.findUnique({ where: { id: dateId } }),
    prisma.bracketMatch.findMany({
      where: { dateId },
      orderBy: [{ round: "asc" }, { position: "asc" }]
    }),
    prisma.player.findMany({ select: { id: true, nickname: true } })
  ]);
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada." });
    return;
  }
  const playersById = new Map(players.map((player) => [player.id, player.nickname]));
  const withNames = bracket.map((match) => ({
    ...match,
    pairA: match.pairAPlayer1 && match.pairAPlayer2
      ? `${playersById.get(match.pairAPlayer1) ?? `#${match.pairAPlayer1}`} + ${playersById.get(match.pairAPlayer2) ?? `#${match.pairAPlayer2}`}`
      : "BYE",
    pairB: match.pairBPlayer1 && match.pairBPlayer2
      ? `${playersById.get(match.pairBPlayer1) ?? `#${match.pairBPlayer1}`} + ${playersById.get(match.pairBPlayer2) ?? `#${match.pairBPlayer2}`}`
      : "BYE"
  }));

  res.json({ date, bracket: withNames });
});

app.get("/public/dates/:id/zones", async (req, res) => {
  const dateId = Number(req.params.id);
  const date = await prisma.tournamentDate.findUnique({ where: { id: dateId } });
  if (!date) {
    res.status(404).json({ error: "Fecha no encontrada." });
    return;
  }
  const zonesComputed = await buildZonesComputed(dateId);
  res.json({ date, zones: zonesComputed });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
