-- Motivos = las 6 áreas de servicio de la landing + Otro (nombres cortos: máx. 20 caracteres por los
-- botones de WhatsApp). Los motivos anteriores NO se borran: quedan inactivos para conservar el
-- motivo de los leads históricos y se pueden reactivar desde Configuración › Motivos.
INSERT INTO "Motivo" ("id", "name", "isActive", "sortOrder") VALUES
  (gen_random_uuid()::text, 'Centrales de riesgo', true, 0),
  (gen_random_uuid()::text, 'Insolvencia y deudas', true, 1),
  (gen_random_uuid()::text, 'Reestructuración', true, 2),
  (gen_random_uuid()::text, 'Procesos y embargos', true, 3),
  (gen_random_uuid()::text, 'Derecho laboral', true, 4),
  (gen_random_uuid()::text, 'Familia y tránsito', true, 5)
ON CONFLICT ("name") DO UPDATE SET "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";

UPDATE "Motivo" SET "isActive" = true, "sortOrder" = 6 WHERE "name" = 'Otro';

UPDATE "Motivo" SET "isActive" = false, "sortOrder" = 10 + "sortOrder"
WHERE "name" IN ('Tránsito', 'Cartera', 'Deudas');
