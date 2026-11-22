-- Línea empresarial (B2B) de la landing: motivo «Soluciones PYMES» antes de «Otro»
INSERT INTO "Motivo" ("id", "name", "isActive", "sortOrder")
VALUES (gen_random_uuid()::text, 'Soluciones PYMES', true, 6)
ON CONFLICT ("name") DO UPDATE SET "isActive" = true, "sortOrder" = 6;

UPDATE "Motivo" SET "sortOrder" = 7 WHERE "name" = 'Otro';
