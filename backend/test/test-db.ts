/**
 * Base de datos de pruebas: la misma instancia de PostgreSQL de desarrollo, pero otra base
 * (<nombre>_test). Las pruebas nunca tocan los datos de desarrollo.
 */
export function testDatabaseUrl(url = process.env.DATABASE_URL ?? ''): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL sin nombre de base de datos');
  if (!name.endsWith('_test')) parsed.pathname = `/${name}_test`;
  return parsed.toString();
}
