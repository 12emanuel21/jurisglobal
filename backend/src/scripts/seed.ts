/**
 * Seed idempotente: se puede correr varias veces sin duplicar ni pisar cambios del equipo.
 *   dev:  npm run seed:dev      prod: npm run seed  (node dist/scripts/seed.js)
 * - Motivos iniciales (Tránsito, Cartera, Deudas, Otro)
 * - Ventanas horarias Ley 2300 (solo si el día no existe)
 * - Festivos de Colombia del año en curso y el siguiente
 * - Parámetros (Setting) que falten
 * - Usuario ADMIN inicial desde ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD (si no existe)
 */
import { PrismaClient, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { colombianHolidays } from '../compliance/holidays';
import { LEY_2300_DEFAULT_WINDOWS, localDateKey } from '../compliance/send-window';
import { SETTING_DEFAULTS } from '../settings/defaults';

const MOTIVOS = ['Tránsito', 'Cartera', 'Deudas', 'Otro'];

export async function seed(prisma: PrismaClient, log: (msg: string) => void = console.log) {
  for (const [sortOrder, name] of MOTIVOS.entries()) {
    await prisma.motivo.upsert({ where: { name }, create: { name, sortOrder }, update: {} });
  }
  log(`✔ Motivos: ${MOTIVOS.join(', ')}`);

  for (const w of LEY_2300_DEFAULT_WINDOWS) {
    await prisma.sendWindow.upsert({ where: { dayOfWeek: w.dayOfWeek }, create: w, update: {} });
  }
  log('✔ Ventanas horarias (Ley 2300): L–V 07:00–19:00, sáb 08:00–15:00, domingo deshabilitado');

  const year = Number(localDateKey(new Date()).slice(0, 4));
  let holidays = 0;
  for (const h of [...colombianHolidays(year), ...colombianHolidays(year + 1)]) {
    const date = new Date(`${h.date}T00:00:00Z`);
    await prisma.holiday.upsert({ where: { date }, create: { date, name: h.name, source: 'SEED' }, update: {} });
    holidays++;
  }
  log(`✔ Festivos de Colombia ${year}–${year + 1}: ${holidays}`);

  let created = 0;
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    const exists = await prisma.setting.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      await prisma.setting.create({ data: { key, value: value as Prisma.InputJsonValue } });
      created++;
    }
  }
  log(`✔ Parámetros: ${created} creados, ${Object.keys(SETTING_DEFAULTS).length - created} ya existían`);

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    log('⚠ ADMIN_EMAIL / ADMIN_PASSWORD no definidos: no se creó el usuario administrador');
  } else if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres');
  } else if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    log(`✔ Administrador ${email} ya existe (no se modificó)`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME?.trim() || 'Administrador',
        role: Role.ADMIN,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    log(`✔ Administrador ${email} creado`);
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log('Seed completo'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
