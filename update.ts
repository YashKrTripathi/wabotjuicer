import { prisma } from './src/db/prisma';

async function update() {
  await prisma.charger.updateMany({
    where: { identity: { not: 'CHARGER_001' } },
    data: { status: 'UNAVAILABLE' }
  });
  console.log('done');
}
update();
