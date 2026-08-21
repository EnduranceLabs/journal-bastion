FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=@journal-labs/bastion deploy --prod --legacy /prod/bastion
RUN pnpm --filter=@journal-labs/bastion-docker-runtime deploy --prod --legacy /prod/mongodb-mcp

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS temporal-cli-build
ARG TARGETARCH
ARG TEMPORAL_CLI_VERSION=1.8.2
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) checksum=d8421bda989e6514b4bdb4d63a9012a8a05a806892e881a5aad8510496349a94 ;; \
      arm64) checksum=83600a8fac6e3da54093e5da6918d399f501532b9f1172235603f9606f4ac6e4 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    archive="temporal_cli_${TEMPORAL_CLI_VERSION}_linux_${TARGETARCH}.tar.gz" && \
    curl --fail --location --silent --show-error \
      "https://github.com/temporalio/cli/releases/download/v${TEMPORAL_CLI_VERSION}/${archive}" \
      --output "/tmp/${archive}" && \
    echo "${checksum}  /tmp/${archive}" | sha256sum --check - && \
    tar -xzf "/tmp/${archive}" -C /usr/local/bin temporal && \
    chmod 0755 /usr/local/bin/temporal

FROM golang:1.26.1-bookworm@sha256:ab3d6955bbc813a0f3fdf220c1d817dd89c0b3f283777db8ece4a32fe7858edd AS tcld-build
ARG TCLD_VERSION=0.55.0
ARG TCLD_COMMIT=4bde81d5c73d36a3316a73f21416cbb6af983384
RUN git clone --filter=blob:none https://github.com/temporalio/tcld.git /src/tcld && \
    cd /src/tcld && \
    git checkout "$TCLD_COMMIT" && \
    test "$(git rev-parse HEAD)" = "$TCLD_COMMIT" && \
    go build \
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
COPY --from=temporal-cli-build /usr/local/bin/temporal /usr/local/bin/temporal
COPY --from=temporal-cli-build /etc/ssl/certs /etc/ssl/certs
COPY --from=tcld-build /out/tcld /usr/local/bin/tcld
COPY --chown=node:node skills/temporal-ops /app/skills/temporal-ops
RUN chmod 0755 /app/dist/integrations/temporal/main.js && \
    ln -s /app/dist/integrations/temporal/main.js /usr/local/bin/journal-temporal-mcp
USER node
ENTRYPOINT ["node", "dist/cli/main.js"]
