# Build a partir da raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t rentix-api .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Só para o "prisma generate" durante o build (o prisma.config.ts exige-o); não passa para a imagem final.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Sem scripts: o postinstall da API (prisma generate) precisa do schema, que ainda não foi copiado.
# O bcrypt traz binários pré-compilados (glibc e musl), não precisa de compilar.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @rentix/shared build \
 && pnpm --filter @rentix/api exec prisma generate \
 && pnpm --filter @rentix/api build \
 && pnpm --filter @rentix/api deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/api/dist /out/ \
 && cd /out && rm -rf src test eslint.config.mjs Dockerfile nest-cli.json tsconfig*.json \
 # Descarrega já o motor de migrações, para o contentor não precisar de internet ao arrancar.
 && ./node_modules/.bin/prisma version

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S rentix && adduser -S rentix -G rentix
COPY --from=build --chown=rentix:rentix /out ./
# Pasta dos ficheiros enviados (STORAGE_DRIVER=local); montar um volume aqui.
RUN mkdir -p /app/storage && chown rentix:rentix /app/storage
USER rentix
EXPOSE 4000
# As migrações correm antes de arrancar (prisma migrate deploy é idempotente).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
