#!/bin/sh
set -eu

echo "[tendering] Waiting for PostgreSQL..."
until npx prisma db execute --stdin >/dev/null 2>&1 <<'SQL'
SELECT 1;
SQL
do
  sleep 2
done

echo "[tendering] Synchronizing database schema..."
npx prisma db push --skip-generate

echo "[tendering] Ensuring default administrator account..."
ADMIN_STATE="$(node - <<'NODE'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  const role = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN', description: 'SUPER_ADMIN role' },
  });
  const user = await prisma.user.upsert({
    where: { email: 'admin@tendering.local' },
    update: { passwordHash, active: true, name: 'Platform Admin' },
    create: {
      email: 'admin@tendering.local',
      passwordHash,
      name: 'Platform Admin',
      active: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  const project = await prisma.project.findUnique({ where: { code: 'ZED-P4-001' }, select: { id: true } });
  process.stdout.write(project ? 'seeded' : 'needs-seed');
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
NODE
)"

if [ "$ADMIN_STATE" = "needs-seed" ]; then
  echo "[tendering] Demo data not found. Running seed..."
  npm run seed
else
  echo "[tendering] Demo data already exists. Skipping full seed."
fi

echo "[tendering] Starting Next.js..."
exec npm run dev
