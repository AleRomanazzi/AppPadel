import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/db.js";

async function run(): Promise<void> {
  const backupPath =
    process.argv[2] ??
    join(process.cwd(), "..", "..", "backups", "neon_backup_2026-07-30T22-57-43-724Z.json");

  const raw = await readFile(backupPath, "utf-8");
  const data = JSON.parse(raw) as {
    players: Array<{ id: number; nickname: string; active: boolean; createdAt: string; updatedAt: string }>;
    partnerHistory: Array<{
      playerAId: number;
      playerBId: number;
      createdAt: string;
    }>;
  };

  const existing = await prisma.player.findMany();
  const byNickname = new Map(existing.map((p) => [p.nickname.toLowerCase(), p]));
  const nicknameToId = new Map<string, number>();

  let created = 0;
  let reused = 0;

  for (const player of data.players) {
    const key = player.nickname.toLowerCase();
    const found = byNickname.get(key);
    if (found) {
      nicknameToId.set(key, found.id);
      reused += 1;
      continue;
    }
    const createdPlayer = await prisma.player.create({
      data: {
        nickname: player.nickname,
        active: player.active ?? true
      }
    });
    nicknameToId.set(key, createdPlayer.id);
    byNickname.set(key, createdPlayer);
    created += 1;
  }

  // Map old backup IDs -> current IDs via nickname for history restore.
  const oldIdToNickname = new Map(data.players.map((p) => [p.id, p.nickname.toLowerCase()]));
  const historyRows = [];
  for (const row of data.partnerHistory ?? []) {
    const nickA = oldIdToNickname.get(row.playerAId);
    const nickB = oldIdToNickname.get(row.playerBId);
    if (!nickA || !nickB) continue;
    const a = nicknameToId.get(nickA);
    const b = nicknameToId.get(nickB);
    if (!a || !b || a === b) continue;
    const [playerAId, playerBId] = a < b ? [a, b] : [b, a];
    historyRows.push({
      playerAId,
      playerBId,
      dateId: null as number | null,
      createdAt: new Date(row.createdAt)
    });
  }

  if (historyRows.length) {
    await prisma.partnerHistory.createMany({ data: historyRows, skipDuplicates: true });
  }

  const [players, history] = await Promise.all([
    prisma.player.count(),
    prisma.partnerHistory.count()
  ]);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        backupPlayers: data.players.length,
        reused,
        created,
        totalPlayers: players,
        history
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Error restaurando jugadores:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
