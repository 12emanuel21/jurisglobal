# Multi-stage (base de KovalCloud). Último stage = PRODUCCIÓN: next build + next start.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# dev: next dev con hot-reload (el código llega por bind mount)
FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Datos públicos de contacto: Next los incrusta al compilar (cambiarlos = reconstruir la imagen)
ARG NEXT_PUBLIC_WHATSAPP_NUMBER=""
ARG NEXT_PUBLIC_WHATSAPP_MESSAGE=""
ARG NEXT_PUBLIC_CONTACT_PHONE=""
ARG NEXT_PUBLIC_CONTACT_EMAIL=""
ARG NEXT_PUBLIC_NIT_INFO=""
ENV NEXT_PUBLIC_WHATSAPP_NUMBER=$NEXT_PUBLIC_WHATSAPP_NUMBER \
    NEXT_PUBLIC_WHATSAPP_MESSAGE=$NEXT_PUBLIC_WHATSAPP_MESSAGE \
    NEXT_PUBLIC_CONTACT_PHONE=$NEXT_PUBLIC_CONTACT_PHONE \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_NIT_INFO=$NEXT_PUBLIC_NIT_INFO
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./
USER node
EXPOSE 3000
CMD ["npm", "start"]
