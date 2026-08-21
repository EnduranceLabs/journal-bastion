FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=@journal-labs/bastion deploy --prod --legacy /prod/bastion
RUN pnpm --filter=@journal-labs/bastion-docker-runtime deploy --prod --legacy /prod/mongodb-mcp

FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS temporal-cli-build
ARG TEMPORAL_CLI_VERSION=1.8.2
ARG TEMPORAL_CLI_COMMIT=c579925f193fe2f0bf5134008125aea0c858ca95
RUN git clone --filter=blob:none https://github.com/temporalio/cli.git /src/temporal-cli && \
    cd /src/temporal-cli && \
    git checkout "$TEMPORAL_CLI_COMMIT" && \
    test "$(git rev-parse HEAD)" = "$TEMPORAL_CLI_COMMIT" && \
    go get \
      golang.org/x/net@v0.58.0 \
      golang.org/x/text@v0.41.0 \
      google.golang.org/grpc@v1.83.1 && \
    CGO_ENABLED=0 go build \
      -ldflags "-s -w -X github.com/temporalio/cli/internal/temporalcli.Version=${TEMPORAL_CLI_VERSION}" \
      -o /out/temporal ./cmd/temporal

FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS tcld-build
ARG TCLD_VERSION=0.55.0
ARG TCLD_COMMIT=4bde81d5c73d36a3316a73f21416cbb6af983384
RUN git clone --filter=blob:none https://github.com/temporalio/tcld.git /src/tcld && \
    cd /src/tcld && \
    git checkout "$TCLD_COMMIT" && \
    test "$(git rev-parse HEAD)" = "$TCLD_COMMIT" && \
    go get \
      golang.org/x/crypto@v0.55.0 \
      golang.org/x/mod@v0.40.0 \
      golang.org/x/net@v0.58.0 \
      golang.org/x/oauth2@v0.36.0 \
      golang.org/x/text@v0.41.0 \
      google.golang.org/grpc@v1.83.1 && \
    CGO_ENABLED=0 go build \
      -ldflags "-s -w -X github.com/temporalio/tcld/app.version=v${TCLD_VERSION} -X github.com/temporalio/tcld/app.commit=${TCLD_COMMIT}" \
      -o /out/tcld ./cmd/tcld

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
COPY --from=temporal-cli-build /out/temporal /usr/local/bin/temporal
COPY --from=temporal-cli-build /etc/ssl/certs /etc/ssl/certs
COPY --from=tcld-build /out/tcld /usr/local/bin/tcld
COPY --chown=node:node skills/temporal-ops /app/skills/temporal-ops
RUN chmod 0755 /app/dist/integrations/temporal/main.js && \
    ln -s /app/dist/integrations/temporal/main.js /usr/local/bin/journal-temporal-mcp
USER node
ENTRYPOINT ["node", "dist/cli/main.js"]
