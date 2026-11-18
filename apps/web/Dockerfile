# Build a partir da raiz do monorepo:
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t rentix-web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# O Next grava o destino do /api/v1 no build: API_URL tem de ser o endereço da API visto pelo servidor web.
ARG API_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1 API_URL=$API_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @rentix/web... --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @rentix/shared build && pnpm --filter @rentix/web build

FROM node:22-alpine AS runtime
ARG API_URL=http://api:4000
# API_URL também é usado em execução (páginas do site renderizadas no servidor).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 API_URL=$API_URL
WORKDIR /app
RUN addgroup -S rentix && adduser -S rentix -G rentix
COPY --from=build --chown=rentix:rentix /repo/apps/web/.next/standalone ./
COPY --from=build --chown=rentix:rentix /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=rentix:rentix /repo/apps/web/public ./apps/web/public
USER rentix
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
