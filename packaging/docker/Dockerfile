FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=@journal-labs/bastion deploy --prod --legacy /prod/bastion

FROM base AS runner
ENV NODE_ENV=production \
    JOURNAL_BASTION_AUTO_INTEGRATIONS=true
WORKDIR /app
COPY --from=build --chown=node:node /prod/bastion ./
USER node
ENTRYPOINT ["node", "dist/cli/main.js"]
