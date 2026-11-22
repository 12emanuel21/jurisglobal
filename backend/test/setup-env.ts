import { testDatabaseUrl } from './test-db';

// Antes de cargar cualquier módulo: Prisma y la validación de entorno usan la base de pruebas
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
