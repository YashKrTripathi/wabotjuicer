import { prisma } from './src/db/prisma';

async function dump() {
  const chargers = await prisma.charger.findMany();
  console.log("Chargers:", chargers);
  const reqs = await prisma.chargingRequest.findMany({ orderBy: { id: 'desc' }, take: 5 });
  console.log("Requests:", reqs);
}
dump();
