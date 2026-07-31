import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { generatePairs, normalizePair, pairKey, validatePair } from "./pairing.js";
import { scoreDiffForPair, isValidSetScore } from "./score.js";
const STAGE_POINTS = {
    OCTAVOS: 15,
    CUARTOS: 25,
    SEMIS: 50,
    SUBCAMPEON: 75,
    CAMPEON: 100
};
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
const port = Number(process.env.PORT ?? 4000);
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "adminPadel.2026";
const ADMIN_TOKEN = "admin-token-apppadel-2026";
const requireAdmin = (req, res, next) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-admin-token"];
    if (token !== ADMIN_TOKEN) {
        res.status(401).json({ error: "No autorizado." });
        return;
    }
    next();
};
const isDateLocked = (date) => {
    if (date.status !== "CLOSED" || !date.closedAt)
        return false;
    return Date.now() > date.closedAt.getTime() + EDIT_WINDOW_MS;
};
const editableUntil = (date) => {
    if (date.status !== "CLOSED" || !date.closedAt)
        return null;
    return new Date(date.closedAt.getTime() + EDIT_WINDOW_MS).toISOString();
};
const assertDateEditable = async (dateId) => {
    const date = await prisma.tournamentDate.findUnique({ where: { id: dateId } });
    if (!date) {
        const error = new Error("Fecha no encontrada");
        error.status = 404;
        throw error;
    }
    if (isDateLocked(date)) {
        const error = new Error("La fecha está cerrada y ya pasaron las 24 hs de edición.");
        error.status = 403;
        throw error;
    }
    return date;
};
const handleDateGuardError = (error, res) => {
    if (error instanceof Error && "status" in error) {
        const status = error.status;
        res.status(status).json({ error: error.message });
        return true;
    }
    return false;
};
const getConstraints = async () => {
    const [blacklistedPlayers, historyPairs] = await Promise.all([
        prisma.blacklistedPlayer.findMany(),
        prisma.partnerHistory.findMany()
    ]);
    const blacklistedIds = blacklistedPlayers.map((item) => item.playerId);
    const blacklist = new Set();
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
const nextPowerOfTwo = (value) => {
    let power = 1;
    while (power < value)
        power *= 2;
    return power;
};
const shuffle = (items) => {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
};
const buildZoneSizes = (pairCount) => {
    if (pairCount <= 0)
        return [];
    // Max 3 pairs per zone. Remainder 1 or 2 only when not multiple of 3.
    const zonesOf3 = Math.floor(pairCount / 3);
    const remainder = pairCount % 3;
    const sizes = Array.from({ length: zonesOf3 }, () => 3);
    if (remainder > 0)
        sizes.push(remainder);
    return sizes;
};
const getRankingScores = async () => {
    const players = await prisma.player.findMany({
        where: { active: true },
        include: { pointsEntries: true }
    });
    return new Map(players.map((player) => [
        player.id,
        player.pointsEntries.reduce((sum, item) => sum + item.points, 0)
    ]));
};
const hasAnyRankingPoints = async () => {
    const entry = await prisma.rankingPointEntry.findFirst({ select: { id: true } });
    return Boolean(entry);
};
const buildZonesComputed = async (dateId) => {
    const [zones, matches, players] = await Promise.all([
        prisma.zone.findMany({ where: { dateId }, orderBy: { name: "asc" } }),
        prisma.zoneMatch.findMany({ where: { dateId }, orderBy: { id: "asc" } }),
        prisma.player.findMany({ select: { id: true, nickname: true } })
    ]);
    const playersById = new Map(players.map((player) => [player.id, player.nickname]));
    return zones.map((zone) => {
        const zoneMatches = matches.filter((match) => match.zoneName === zone.name);
        const pairsMap = new Map();
        const ensurePair = (p1, p2) => {
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
            if (pairA)
                pairA.played += 1;
            if (pairB)
                pairB.played += 1;
            if (match.winnerPairKey && pairsMap.has(match.winnerPairKey)) {
                const winner = pairsMap.get(match.winnerPairKey);
                if (winner)
                    winner.wins += 1;
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
            if (b.wins !== a.wins)
                return b.wins - a.wins;
            if (b.setDiff !== a.setDiff)
                return b.setDiff - a.setDiff;
            if (b.gameDiff !== a.gameDiff)
                return b.gameDiff - a.gameDiff;
            return a.label.localeCompare(b.label);
        });
        return {
            id: zone.id,
            name: zone.name,
            pairs: sortedPairs,
            matches: normalizedMatches,
            // Hasta 3 parejas por zona clasifican (1º directo, 2º y 3º a instancia previa).
            qualifiers: sortedPairs.slice(0, Math.min(3, sortedPairs.length)).map((pair, index) => ({
                key: pair.key,
                label: pair.label,
                player1: pair.player1,
                player2: pair.player2,
                place: index + 1
            }))
        };
    });
};
const pairLabel = (p1, p2, playersById) => {
    if (p1 == null || p2 == null)
        return null;
    return `${playersById.get(p1) ?? `#${p1}`} + ${playersById.get(p2) ?? `#${p2}`}`;
};
const bracketPairKey = (p1, p2) => {
    if (p1 == null || p2 == null)
        return null;
    return pairKey(p1, p2);
};
const stageForLostRound = (round, maxRound) => {
    const fromFinal = maxRound - round;
    if (fromFinal <= 1)
        return "SEMIS";
    if (fromFinal === 2)
        return "CUARTOS";
    return "OCTAVOS";
};
const computeStageAssignments = (matches) => {
    const assignments = new Map();
    if (matches.length === 0)
        return assignments;
    const maxRound = Math.max(...matches.map((m) => m.round));
    const setStage = (playerId, stage) => {
        if (playerId == null)
            return;
        const current = assignments.get(playerId);
        const rank = {
            OCTAVOS: 1,
            CUARTOS: 2,
            SEMIS: 3,
            SUBCAMPEON: 4,
            CAMPEON: 5
        };
        if (!current || rank[stage] > rank[current]) {
            assignments.set(playerId, stage);
        }
    };
    for (const match of matches) {
        if (!match.winnerPairKey)
            continue;
        const keyA = bracketPairKey(match.pairAPlayer1, match.pairAPlayer2);
        const keyB = bracketPairKey(match.pairBPlayer1, match.pairBPlayer2);
        const winnerIsA = match.winnerPairKey === keyA;
        const loserPlayers = winnerIsA
            ? [match.pairBPlayer1, match.pairBPlayer2]
            : [match.pairAPlayer1, match.pairAPlayer2];
        const winnerPlayers = winnerIsA
            ? [match.pairAPlayer1, match.pairAPlayer2]
            : [match.pairBPlayer1, match.pairBPlayer2];
        if (match.round === maxRound) {
            winnerPlayers.forEach((id) => setStage(id, "CAMPEON"));
            loserPlayers.forEach((id) => setStage(id, "SUBCAMPEON"));
        }
        else {
            const stage = stageForLostRound(match.round, maxRound);
            loserPlayers.forEach((id) => setStage(id, stage));
        }
    }
    return assignments;
};
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/auth/login", (req, res) => {
    const body = req.body;
    if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
        res.status(401).json({ error: "Credenciales inválidas." });
        return;
    }
    res.json({ token: ADMIN_TOKEN, user: { username: ADMIN_USERNAME } });
});
app.get("/players", requireAdmin, async (_req, res) => {
    const players = await prisma.player.findMany({ orderBy: [{ active: "desc" }, { nickname: "asc" }] });
    res.json(players);
});
app.post("/players", requireAdmin, async (req, res) => {
    const payload = req.body;
    const nickname = payload.nickname?.trim();
    if (!nickname) {
        res.status(400).json({ error: "El apodo es obligatorio." });
        return;
    }
    try {
        const player = await prisma.player.create({ data: { nickname } });
        res.status(201).json(player);
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            res.status(409).json({ error: "El apodo ya existe. Debe ser irrepetible." });
            return;
        }
        throw error;
    }
});
app.put("/players/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const payload = req.body;
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
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            res.status(409).json({ error: "El apodo ya existe. Debe ser irrepetible." });
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
app.get("/blacklist", requireAdmin, async (_req, res) => {
    const entries = await prisma.blacklistedPlayer.findMany({
        include: { player: true },
        orderBy: { player: { nickname: "asc" } }
    });
    res.json(entries.map((entry) => entry.player));
});
app.put("/blacklist", requireAdmin, async (req, res) => {
    const body = req.body;
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
        .filter((item) => Boolean(item))
        .sort((a, b) => a.nickname.localeCompare(b.nickname));
    res.json(partners);
});
app.get("/dates", async (_req, res) => {
    const dates = await prisma.tournamentDate.findMany({ orderBy: { eventDate: "desc" } });
    res.json(dates);
});
const parseDateOnly = (value) => {
    const trimmed = value?.trim();
    if (!trimmed)
        return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) {
        // Mediodía UTC para que el día de calendario no se corra por timezone.
        return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};
app.post("/dates", requireAdmin, async (req, res) => {
    const payload = req.body;
    const name = payload.name?.trim();
    const eventDate = payload.eventDate ? parseDateOnly(payload.eventDate) : null;
    if (!name) {
        res.status(400).json({ error: "El nombre de la fecha es obligatorio." });
        return;
    }
    if (!eventDate) {
        res.status(400).json({ error: "La fecha del día es inválida." });
        return;
    }
    const created = await prisma.tournamentDate.create({
        data: { name, eventDate, status: "OPEN" }
    });
    res.status(201).json(created);
});
app.post("/dates/:id/registrations", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const body = req.body;
        const data = body.playerIds.map((playerId) => ({ dateId, playerId }));
        await prisma.dateRegistration.createMany({ data, skipDuplicates: true });
        const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
        res.status(201).json(registrations);
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.put("/dates/:id/registrations", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const body = req.body;
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.post("/dates/:id/seeds", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const body = req.body;
        await prisma.dateSeed.deleteMany({ where: { dateId } });
        await prisma.dateSeed.createMany({
            data: body.playerIds.map((playerId) => ({ dateId, playerId }))
        });
        res.status(201).json({ ok: true });
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.post("/dates/:id/seeds/auto", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const registrations = await prisma.dateRegistration.findMany({
            where: { dateId },
            include: { player: { select: { id: true, nickname: true, active: true } } }
        });
        const attendees = registrations.map((r) => r.player).filter((p) => p.active);
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
        const seasonStarted = await hasAnyRankingPoints();
        let mode = "random";
        let seedIds = [];
        if (!seasonStarted) {
            mode = "random";
            seedIds = shuffle(attendees.map((a) => a.id)).slice(0, n);
        }
        else {
            mode = "ranking";
            const scores = await getRankingScores();
            const rankedAttendees = [...attendees].sort((a, b) => {
                const diff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
                if (diff !== 0)
                    return diff;
                return a.nickname.localeCompare(b.nickname);
            });
            seedIds = rankedAttendees.slice(0, n).map((p) => p.id);
        }
        await prisma.$transaction([
            prisma.dateSeed.deleteMany({ where: { dateId } }),
            prisma.dateSeed.createMany({ data: seedIds.map((playerId) => ({ dateId, playerId })) }),
            prisma.blacklistedPlayer.deleteMany({}),
            prisma.blacklistedPlayer.createMany({ data: seedIds.map((playerId) => ({ playerId })) })
        ]);
        const playersById = new Map(attendees.map((p) => [p.id, p.nickname]));
        res.status(201).json({
            mode,
            zoneCount: n,
            zoneSizes,
            seeds: seedIds.map((playerId) => ({
                playerId,
                nickname: playersById.get(playerId) ?? `#${playerId}`
            }))
        });
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.post("/dates/:id/draw/generate", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
        const playerIds = registrations.map((r) => r.playerId);
        if (playerIds.length % 2 !== 0) {
            res.status(400).json({ error: "La cantidad de asistentes debe ser par." });
            return;
        }
        const { blacklist, history } = await getConstraints();
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.put("/dates/:id/draw/manual-adjust", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        await assertDateEditable(dateId);
        const body = req.body;
        const { blacklist, history } = await getConstraints();
        const errors = [];
        body.pairs.forEach((pair) => {
            const result = validatePair(pair.player1, pair.player2, blacklist, history);
            if (!result.valid)
                errors.push(`${pair.player1}-${pair.player2}: ${result.reason}`);
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.post("/dates/:id/zones/generate", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
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
        const seeds = await prisma.dateSeed.findMany({ where: { dateId } });
        const seedIds = new Set(seeds.map((s) => s.playerId));
        const blacklistedIds = seedIds.size > 0 ? seedIds : new Set((await prisma.blacklistedPlayer.findMany({ select: { playerId: true } })).map((i) => i.playerId));
        const pairs = draw.pairs.map((pair) => {
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
                hasBlacklist: blacklistedIds.has(pair.player1) || blacklistedIds.has(pair.player2)
            };
        });
        const zoneSizes = buildZoneSizes(pairs.length);
        const zones = zoneSizes.map((size, index) => ({
            name: `Zona ${String.fromCharCode(65 + index)}`,
            size,
            pairs: []
        }));
        // One seed head per zone
        const seedPairs = shuffle(pairs.filter((pair) => pair.seedPlayerId != null));
        zones.forEach((zone, index) => {
            if (seedPairs[index])
                zone.pairs.push(seedPairs[index]);
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
                if (aPenalty !== bPenalty)
                    return aPenalty - bPenalty;
                return a.pairs.length - b.pairs.length;
            });
            if (candidates[0])
                candidates[0].pairs.push(pair);
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.put("/dates/:dateId/zones/matches/:matchId", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.dateId);
        await assertDateEditable(dateId);
        const matchId = Number(req.params.matchId);
        const body = req.body;
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
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
        const firsts = [];
        const seconds = [];
        const thirds = [];
        zonesComputed.forEach((zone, zoneIndex) => {
            zone.qualifiers.forEach((q) => {
                const item = {
                    player1: q.player1,
                    player2: q.player2,
                    key: q.key,
                    zoneIndex,
                    place: q.place
                };
                if (q.place === 1)
                    firsts.push(item);
                else if (q.place === 2)
                    seconds.push(item);
                else if (q.place === 3)
                    thirds.push(item);
            });
        });
        // 2º de una zona vs 3º de otra (cruce). Si falta 3º, se emparejan restantes.
        const playInMatches = [];
        const usedKeys = new Set();
        for (let i = 0; i < seconds.length; i += 1) {
            const second = seconds[i];
            if (usedKeys.has(second.key))
                continue;
            const third = thirds.find((t) => t.zoneIndex !== second.zoneIndex && !usedKeys.has(t.key)) ??
                thirds.find((t) => !usedKeys.has(t.key));
            if (!third)
                continue;
            usedKeys.add(second.key);
            usedKeys.add(third.key);
            playInMatches.push([second, third]);
        }
        // Segundos/terceros sueltos se emparejan entre sí
        const leftovers = [...seconds, ...thirds].filter((p) => !usedKeys.has(p.key));
        for (let i = 0; i + 1 < leftovers.length; i += 2) {
            playInMatches.push([leftovers[i], leftovers[i + 1]]);
            usedKeys.add(leftovers[i].key);
            usedKeys.add(leftovers[i + 1].key);
        }
        const leftoverBye = leftovers.find((p) => !usedKeys.has(p.key)) ?? null;
        const r1Matchups = [];
        const playInQueue = [...playInMatches];
        const firstQueue = [...firsts];
        if (leftoverBye) {
            // El suelto entra como si fuera un "1º" con bye a la siguiente ronda.
            firstQueue.push(leftoverBye);
        }
        while (firstQueue.length > 0 || playInQueue.length > 0) {
            if (firstQueue.length > 0) {
                const first = firstQueue.shift();
                r1Matchups.push([{ player1: first.player1, player2: first.player2 }, null]);
            }
            if (playInQueue.length > 0) {
                const [a, b] = playInQueue.shift();
                r1Matchups.push([
                    { player1: a.player1, player2: a.player2 },
                    { player1: b.player1, player2: b.player2 }
                ]);
            }
        }
        if (r1Matchups.length < 1) {
            res.status(400).json({ error: "No hay suficientes clasificados para armar el cuadro." });
            return;
        }
        const targetMatchups = nextPowerOfTwo(r1Matchups.length);
        while (r1Matchups.length < targetMatchups) {
            r1Matchups.push([null, null]);
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
                pairAPlayer1: null,
                pairAPlayer2: null,
                pairBPlayer1: null,
                pairBPlayer2: null
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
                const winnerKey = pairKey(match.pairAPlayer1, match.pairAPlayer2);
                await prisma.bracketMatch.update({
                    where: { id: match.id },
                    data: { winnerPairKey: winnerKey, score: "BYE" }
                });
                await advanceWinner(dateId, match.round, match.position, match.pairAPlayer1, match.pairAPlayer2);
            }
            else if (!aOk && bOk) {
                const winnerKey = pairKey(match.pairBPlayer1, match.pairBPlayer2);
                await prisma.bracketMatch.update({
                    where: { id: match.id },
                    data: { winnerPairKey: winnerKey, score: "BYE" }
                });
                await advanceWinner(dateId, match.round, match.position, match.pairBPlayer1, match.pairBPlayer2);
            }
        }
        const bracket = await prisma.bracketMatch.findMany({
            where: { dateId },
            orderBy: [{ round: "asc" }, { position: "asc" }]
        });
        res.status(201).json(bracket);
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
async function advanceWinner(dateId, round, position, player1, player2) {
    const nextRound = round + 1;
    const nextPosition = Math.ceil(position / 2);
    const nextMatch = await prisma.bracketMatch.findUnique({
        where: { dateId_round_position: { dateId, round: nextRound, position: nextPosition } }
    });
    if (!nextMatch)
        return;
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
        const body = req.body;
        const match = await prisma.bracketMatch.findUnique({ where: { id: matchId } });
        if (!match || match.dateId !== dateId) {
            res.status(404).json({ error: "Partido de cuadro no encontrado." });
            return;
        }
        const keyA = bracketPairKey(match.pairAPlayer1, match.pairAPlayer2);
        const keyB = bracketPairKey(match.pairBPlayer1, match.pairBPlayer2);
        const validKeys = [keyA, keyB].filter(Boolean);
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
            await advanceWinner(dateId, match.round, match.position, match.pairAPlayer1, match.pairAPlayer2);
        }
        else if (body.winnerPairKey && keyB && body.winnerPairKey === keyB) {
            await advanceWinner(dateId, match.round, match.position, match.pairBPlayer1, match.pairBPlayer2);
        }
        const bracket = await prisma.bracketMatch.findMany({
            where: { dateId },
            orderBy: [{ round: "asc" }, { position: "asc" }]
        });
        res.json({ match: updated, bracket });
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
});
app.post("/dates/:id/close", requireAdmin, async (req, res) => {
    try {
        const dateId = Number(req.params.id);
        const date = await assertDateEditable(dateId);
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
        const assignments = computeStageAssignments(bracket);
        const firstSeasonDate = await prisma.tournamentDate.findFirst({
            orderBy: [{ eventDate: "asc" }, { id: "asc" }]
        });
        const isDoublePoints = firstSeasonDate?.id === dateId;
        const pointsMultiplier = isDoublePoints ? 2 : 1;
        await prisma.$transaction(async (tx) => {
            await tx.rankingPointEntry.deleteMany({ where: { dateId, manual: false } });
            await tx.partnerHistory.deleteMany({ where: { dateId } });
            if (assignments.size > 0) {
                await tx.rankingPointEntry.createMany({
                    data: Array.from(assignments.entries()).map(([playerId, stage]) => ({
                        playerId,
                        dateId,
                        points: STAGE_POINTS[stage] * pointsMultiplier,
                        reason: `Fecha ${dateId} - ${stage}${isDoublePoints ? " (x2 primera fecha)" : ""}`,
                        manual: false
                    }))
                });
            }
            await tx.partnerHistory.createMany({
                data: draw.pairs.map((pair) => {
                    const [a, b] = normalizePair(pair.player1, pair.player2);
                    return { playerAId: a, playerBId: b, dateId };
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
        const updated = await prisma.tournamentDate.findUnique({ where: { id: dateId } });
        res.json({
            date: updated,
            editableUntil: updated ? editableUntil(updated) : null,
            doublePoints: isDoublePoints,
            assignments: Array.from(assignments.entries()).map(([playerId, stage]) => ({
                playerId,
                stage,
                points: STAGE_POINTS[stage] * pointsMultiplier
            }))
        });
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
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
    const pairsWithNames = draw?.pairs.map((pair) => ({
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
        date,
        locked: isDateLocked(date),
        editableUntil: editableUntil(date),
        registrations: registrations.map((item) => item.player),
        seeds: seeds.map((seed) => ({
            playerId: seed.playerId,
            nickname: playersById.get(seed.playerId) ?? `#${seed.playerId}`
        })),
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
        const body = req.body;
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
    }
    catch (error) {
        if (handleDateGuardError(error, res))
            return;
        throw error;
    }
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
    const body = req.body;
    const entry = await prisma.rankingPointEntry.create({
        data: { playerId: body.playerId, points: body.points, reason: body.reason, manual: true }
    });
    res.status(201).json(entry);
});
app.post("/ranking/manual-adjustments", requireAdmin, async (req, res) => {
    const body = req.body;
    if (!Array.isArray(body.items) || body.items.length === 0) {
        res.status(400).json({ error: "Debes enviar al menos un ajuste manual." });
        return;
    }
    const created = await prisma.$transaction(body.items.map((item) => prisma.rankingPointEntry.create({
        data: {
            playerId: item.playerId,
            points: item.points,
            reason: item.reason,
            manual: true
        }
    })));
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
        select: { id: true, name: true, eventDate: true, status: true, closedAt: true }
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
        pairA: pairLabel(match.pairAPlayer1, match.pairAPlayer2, playersById) ?? "BYE",
        pairB: pairLabel(match.pairBPlayer1, match.pairBPlayer2, playersById) ?? "BYE",
        pairAKey: bracketPairKey(match.pairAPlayer1, match.pairAPlayer2),
        pairBKey: bracketPairKey(match.pairBPlayer1, match.pairBPlayer2)
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
