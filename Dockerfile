# syntax=docker/dockerfile:1
# One Dockerfile, three runtime targets: web, bot, worker.
FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/database/package.json packages/database/
COPY packages/discord/package.json packages/discord/
COPY packages/integrations/package.json packages/integrations/
COPY packages/security/package.json packages/security/
COPY packages/services/package.json packages/services/
COPY packages/shared/package.json packages/shared/
COPY packages/workflows/package.json packages/workflows/
RUN npm ci --no-audit --no-fund

FROM deps AS source
COPY . .

FROM source AS web-build
RUN npm run build -w @botcooks/web

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# Bot and worker run their TypeScript sources with tsx (pinned in their package.json).
FROM source AS bot
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/tsx", "apps/bot/src/index.ts"]

FROM source AS worker
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/tsx", "apps/worker/src/index.ts"]
