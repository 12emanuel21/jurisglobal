import { testDatabaseUrl } from './test-db';

// Antes de cargar cualquier módulo: Prisma y la validación de entorno usan la base de pruebas
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
// Claves propias en Redis por archivo de pruebas: el límite por IP y las colas BullMQ no se mezclan
// con el worker de desarrollo ni con otras corridas
process.env.REDIS_KEY_PREFIX = `jgtest:${process.pid}:${Date.now().toString(36)}:`;
