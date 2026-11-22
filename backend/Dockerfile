# Multi-stage (base de KovalCloud). Último stage = PRODUCCIÓN.
# Desarrollo: docker compose -p jurisglobal -f docker-compose.yml -f docker-compose.dev.yml up

FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# deps: toolchain para compilar bcrypt
FROM base AS deps
RUN apt-get update -y && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# dev: hot-reload (el código llega por bind mount)
FROM deps AS dev
COPY . .
EXPOSE 4000
CMD ["npm", "run", "start:dev"]

# build: compila a dist/ y quita devDependencies
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS prod
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN mkdir -p uploads/chat && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
