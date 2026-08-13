import "dotenv/config";
import { prisma } from "../src/db.js";

/** Limpia fechas, partidos, puntos (todos) y blacklist; conserva jugadores e historial manual de parejas. */
async function run(): Promise<void> {
  await prisma.bracketMatch.deleteMany({});
  await prisma.zoneMatch.deleteMany({});
  await prisma.zone.deleteMany({});
  await prisma.drawPair.deleteMany({});
  await prisma.dateDraw.deleteMany({});
  await prisma.dateSeed.deleteMany({});
  await prisma.dateRegistration.deleteMany({});
  await prisma.tournamentDate.deleteMany({});
  await prisma.tournamentEvent.deleteMany({});
  await prisma.rankingPointEntry.deleteMany({});
  await prisma.blacklistedPlayer.deleteMany({});
  await prisma.partnerHistory.deleteMany({ where: { dateId: { not: null } } });

  const summary = {
    players: await prisma.player.count(),
    dates: await prisma.tournamentDate.count(),
    points: await prisma.rankingPointEntry.count(),
    history: await prisma.partnerHistory.count()
  };
  // eslint-disable-next-line no-console
  console.log("Limpieza OK:", summary);
}

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
