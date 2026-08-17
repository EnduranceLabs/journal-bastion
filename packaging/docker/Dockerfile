FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=@journal-labs/bastion deploy --prod --legacy /prod/bastion
RUN pnpm --filter=@journal-labs/bastion-docker-runtime deploy --prod --legacy /prod/mongodb-mcp

FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runner
ARG IMAGE_VERSION=development
ARG VCS_REF=unknown
ENV NODE_ENV=production \
    JOURNAL_BASTION_AUTO_INTEGRATIONS=true \
    PATH=/opt/mongodb-mcp/node_modules/.bin:$PATH
LABEL org.opencontainers.image.source="https://github.com/EnduranceLabs/journal-bastion" \
      org.opencontainers.image.description="Outbound bastion for connecting customer-hosted MCP servers to Journal" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$IMAGE_VERSION" \
      org.opencontainers.image.revision="$VCS_REF"
RUN corepack disable && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
WORKDIR /app
COPY --from=build --chown=node:node /prod/bastion ./
COPY --from=build /prod/mongodb-mcp /opt/mongodb-mcp
USER node
ENTRYPOINT ["node", "dist/cli/main.js"]
