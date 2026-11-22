import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from './test-db';

/** Crea <db>_test si no existe y le aplica las migraciones (prisma migrate deploy) */
export default async function globalSetup() {
  const mainUrl = process.env.DATABASE_URL;
  if (!mainUrl) throw new Error('DATABASE_URL es obligatoria para las pruebas de integración');
  const testUrl = testDatabaseUrl(mainUrl);
  const dbName = new URL(testUrl).pathname.slice(1);

  const admin = new PrismaClient({ datasourceUrl: mainUrl });
  try {
    const exists = await admin.$queryRaw<
      Array<{ ok: number }>
    >`SELECT 1 AS ok FROM pg_database WHERE datname = ${dbName}`;
    if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await admin.$disconnect();
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'pipe' });
}
