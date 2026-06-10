import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding 3 mock chargers...');

  const chargers = ['CHARGER_001', 'CHARGER_002', 'CHARGER_003'];

  for (const identity of chargers) {
    await prisma.charger.upsert({
      where: { identity },
      update: {},
      create: {
        identity,
        vendor: 'Ebee',
        model: 'Mock-22kW',
        status: 'AVAILABLE',
      },
    });
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
