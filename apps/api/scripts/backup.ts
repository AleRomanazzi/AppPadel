import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/db.js";

async function run(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = join(process.cwd(), "..", "..", "backups");
  await mkdir(root, { recursive: true });

  const payload = {
    exportedAt: new Date().toISOString(),
    players: await prisma.player.findMany(),
    blacklistedPlayers: await prisma.blacklistedPlayer.findMany(),
    partnerHistory: await prisma.partnerHistory.findMany(),
    tournamentDates: await prisma.tournamentDate.findMany(),
    dateRegistrations: await prisma.dateRegistration.findMany(),
    dateSeeds: await prisma.dateSeed.findMany(),
    dateDraws: await prisma.dateDraw.findMany(),
    drawPairs: await prisma.drawPair.findMany(),
    zones: await prisma.zone.findMany(),
    zoneMatches: await prisma.zoneMatch.findMany(),
    bracketMatches: await prisma.bracketMatch.findMany(),
    rankingPointEntries: await prisma.rankingPointEntry.findMany()
  };

  const target = join(root, `neon_backup_${timestamp}.json`);
  await writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Backup generado en: ${target}`);
}

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Error generando backup:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
