import "dotenv/config";
import { prisma } from "../src/db.js";

async function run(): Promise<void> {
  const before = await prisma.rankingPointEntry.count();
  const deleted = await prisma.rankingPointEntry.deleteMany({});
  const after = await prisma.rankingPointEntry.count();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ before, deleted: deleted.count, after, bootstrapReady: after === 0 }, null, 2));
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
