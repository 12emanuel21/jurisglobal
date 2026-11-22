import { PrismaClient } from '@prisma/client';
import { seed } from '../src/scripts/seed';

/** Vacía todas las tablas (salvo la de migraciones) y vuelve a sembrar los datos base */
export async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await seed(prisma, () => undefined);
}

/** Espera a que se cumpla una condición (trabajo en segundo plano, p. ej. el aviso por correo) */
export async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: tiempo agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}
