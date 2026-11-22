# JurisGlobal · atajos. Todos fijan el proyecto "jurisglobal": nunca tocan los contenedores de KovalCloud.
PROD = docker compose -p jurisglobal -f docker-compose.yml
DEV  = docker compose -p jurisglobal -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev up down logs worker-logs ps migrate migrate-dev seed seed-prod test test-web lint build backup

help:
	@echo "make dev          Levanta en desarrollo (hot-reload; puertos 8088, 4100, 3100, 55432, 56379 en 127.0.0.1)"
	@echo "make up           Levanta en producción (imágenes compiladas; solo 127.0.0.1:8088)"
	@echo "make down         Detiene la instancia (conserva los datos)"
	@echo "make worker-logs  Logs del worker de masivos"
	@echo "make migrate      Aplica migraciones (prisma migrate deploy)"
	@echo "make migrate-dev name=xxx   Crea una migración nueva (solo desarrollo)"
	@echo "make seed         Seed idempotente (dev)    make seed-prod   Seed en producción"
	@echo "make test         Pruebas del backend       make lint        Lint backend y frontend"
	@echo "make backup       pg_dump a ./backups (retención 14 días)"

dev:
	$(DEV) up -d --build

up:
	$(PROD) up -d --build

down:
	$(DEV) down

logs:
	$(DEV) logs -f --tail=100

worker-logs:
	$(DEV) logs -f --tail=100 worker

ps:
	$(DEV) ps

migrate:
	$(DEV) exec api npx prisma migrate deploy

migrate-dev:
	$(DEV) exec api npx prisma migrate dev --name $(name)

seed:
	$(DEV) exec api npm run seed:dev

seed-prod:
	$(PROD) exec api npm run seed

test:
	$(DEV) exec api npm run test:all
	$(DEV) exec web npm test

lint:
	$(DEV) exec api npx tsc --noEmit --incremental false
	$(DEV) exec api npx eslint --quiet "{src,test}/**/*.ts"
	$(DEV) exec web npx tsc --noEmit --incremental false
	$(DEV) exec web npx eslint

build:
	$(PROD) build

backup:
	./scripts/backup_db.sh
