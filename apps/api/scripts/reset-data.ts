import "dotenv/config";
import { prisma } from "../src/db.js";

type Mode = "all" | "tournament";

function parseMode(argv: string[]): Mode {
  if (argv.includes("--tournament")) return "tournament";
  return "all";
}

async function wipeTournamentData(): Promise<void> {
  // Order respects FKs; TournamentDate cascade covers most children,
  // but we also clear orphan-ish tables explicitly.
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
  await prisma.partnerHistory.deleteMany({ where: { dateId: { not: null } } });
  await prisma.blacklistedPlayer.deleteMany({});
}

async function wipeAllData(): Promise<void> {
  await wipeTournamentData();
  await prisma.rankingPointEntry.deleteMany({});
  await prisma.partnerHistory.deleteMany({});
  await prisma.blacklistedPlayer.deleteMany({});
  await prisma.player.deleteMany({});
}

async function countRows() {
  const [
    players,
    blacklist,
    history,
    dates,
    points
  ] = await Promise.all([
    prisma.player.count(),
    prisma.blacklistedPlayer.count(),
    prisma.partnerHistory.count(),
    prisma.tournamentDate.count(),
    prisma.rankingPointEntry.count()
  ]);
  return { players, blacklist, history, dates, points };
}

async function run(): Promise<void> {
  const confirmed = process.env.CONFIRM_RESET === "YES";
  if (!confirmed) {
    // eslint-disable-next-line no-console
    console.error(`
Reset abortado: falta confirmación.

Uso:
  CONFIRM_RESET=YES npm run reset:data -w api
  CONFIRM_RESET=YES npm run reset:data -w api -- --tournament

Modos:
  (default)  Borra TODO (jugadores, historial, fechas, puntos, blacklist)
  --tournament  Borra fechas/sorteos/zonas/cuadro + puntos automáticos + historial ligado a fechas
                (conserva jugadores, blacklist y historial manual)
`);
    process.exitCode = 1;
    return;
  }

  const mode = parseMode(process.argv.slice(2));
  const before = await countRows();
  // eslint-disable-next-line no-console
  console.log(`Reset mode=${mode}. Antes:`, before);

  if (mode === "tournament") {
    await wipeTournamentData();
  } else {
    await wipeAllData();
  }

  const after = await countRows();
  // eslint-disable-next-line no-console
  console.log("Reset OK. Después:", after);
}

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Error en reset:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
