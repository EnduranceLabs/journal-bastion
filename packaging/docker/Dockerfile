FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=journal-bastion-protocol --filter=journal-bastion build
RUN pnpm --filter=journal-bastion deploy --prod --legacy /prod/bastion

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/bastion ./
ENTRYPOINT ["node", "dist/main.js"]
