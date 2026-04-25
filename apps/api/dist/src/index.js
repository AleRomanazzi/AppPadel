import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { STAGE_POINTS } from "@apppadel/shared";
import { prisma } from "./db.js";
import { generatePairs, normalizePair, pairKey, validatePair } from "./pairing.js";
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
const port = Number(process.env.PORT ?? 4000);
const getConstraints = async () => {
    const [blacklistPairs, historyPairs] = await Promise.all([
        prisma.blacklistPair.findMany(),
        prisma.partnerHistory.findMany()
    ]);
    return {
        blacklist: new Set(blacklistPairs.map((item) => pairKey(item.playerAId, item.playerBId))),
        history: new Set(historyPairs.map((item) => pairKey(item.playerAId, item.playerBId)))
    };
};
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/players", async (_req, res) => {
    const players = await prisma.player.findMany({ orderBy: { id: "asc" } });
    res.json(players);
});
app.post("/players", async (req, res) => {
    const payload = req.body;
    const player = await prisma.player.create({ data: payload });
    res.status(201).json(player);
});
app.put("/players/:id", async (req, res) => {
    const id = Number(req.params.id);
    const payload = req.body;
    const player = await prisma.player.update({ where: { id }, data: payload });
    res.json(player);
});
app.post("/players/:id/blacklist/:otherId", async (req, res) => {
    const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
    const created = await prisma.blacklistPair.upsert({
        where: { playerAId_playerBId: { playerAId: a, playerBId: b } },
        update: {},
        create: { playerAId: a, playerBId: b }
    });
    res.status(201).json(created);
});
app.delete("/players/:id/blacklist/:otherId", async (req, res) => {
    const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
    await prisma.blacklistPair.delete({ where: { playerAId_playerBId: { playerAId: a, playerBId: b } } });
    res.status(204).send();
});
app.post("/players/:id/partners-history/:otherId", async (req, res) => {
    const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
    const created = await prisma.partnerHistory.upsert({
        where: { playerAId_playerBId: { playerAId: a, playerBId: b } },
        update: {},
        create: { playerAId: a, playerBId: b }
    });
    res.status(201).json(created);
});
app.delete("/players/:id/partners-history/:otherId", async (req, res) => {
    const [a, b] = normalizePair(Number(req.params.id), Number(req.params.otherId));
    await prisma.partnerHistory.delete({ where: { playerAId_playerBId: { playerAId: a, playerBId: b } } });
    res.status(204).send();
});
app.get("/dates", async (_req, res) => {
    const dates = await prisma.tournamentDate.findMany({ orderBy: { eventDate: "desc" } });
    res.json(dates);
});
app.post("/dates", async (req, res) => {
    const payload = req.body;
    const created = await prisma.tournamentDate.create({
        data: { name: payload.name, eventDate: new Date(payload.eventDate) }
    });
    res.status(201).json(created);
});
app.post("/dates/:id/registrations", async (req, res) => {
    const dateId = Number(req.params.id);
    const body = req.body;
    const data = body.playerIds.map((playerId) => ({ dateId, playerId }));
    await prisma.dateRegistration.createMany({ data, skipDuplicates: true });
    const registrations = await prisma.dateRegistration.findMany({ where: { dateId } });
    res.status(201).json(registrations);
});
app.post("/dates/:id/seeds", async (req, res) => {
    const dateId = Number(req.params.id);
    const body = req.body;
    await prisma.dateSeed.deleteMany({ where: { dateId } });
    await prisma.dateSeed.createMany({
        data: body.playerIds.slice(0, 4).map((playerId) => ({ dateId, playerId }))
    });
    res.status(201).json({ ok: true });
});
app.post("/dates/:id/draw/generate", async (req, res) => {
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
app.put("/dates/:id/draw/manual-adjust", async (req, res) => {
    const dateId = Number(req.params.id);
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
    await prisma.partnerHistory.createMany({
        data: body.pairs.map((pair) => {
            const [a, b] = normalizePair(pair.player1, pair.player2);
            return { playerAId: a, playerBId: b, dateId };
        }),
        skipDuplicates: true
    });
    res.json(draw);
});
app.post("/dates/:id/zones/generate", async (req, res) => {
    const dateId = Number(req.params.id);
    const body = req.body;
    const draw = await prisma.dateDraw.findFirst({
        where: { dateId },
        orderBy: { createdAt: "desc" },
        include: { pairs: true }
    });
    if (!draw) {
        res.status(404).json({ error: "No hay sorteo generado" });
        return;
    }
    const size = body.size ?? 4;
    await prisma.zone.deleteMany({ where: { dateId } });
    const zonesCount = Math.max(1, Math.ceil(draw.pairs.length / size));
    const zones = await Promise.all(Array.from({ length: zonesCount }, (_, i) => prisma.zone.create({
        data: { dateId, name: `Zona ${String.fromCharCode(65 + i)}`, size }
    })));
    res.status(201).json(zones);
});
app.post("/dates/:id/results", async (req, res) => {
    const dateId = Number(req.params.id);
    const body = req.body;
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
        name: `${player.firstName} ${player.lastName}`,
        nickname: player.nickname,
        points: player.pointsEntries.reduce((sum, item) => sum + item.points, 0)
    }))
        .sort((a, b) => b.points - a.points);
    res.json(ranking);
});
app.post("/ranking/manual-adjustment", async (req, res) => {
    const body = req.body;
    const entry = await prisma.rankingPointEntry.create({
        data: { playerId: body.playerId, points: body.points, reason: body.reason, manual: true }
    });
    res.status(201).json(entry);
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
app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
});
