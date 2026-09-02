#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${IMAGE:-journal-bastion:phase2}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [ "${BUILD_IMAGE:-1}" = "1" ]; then
  docker build --pull \
    -f "$repo_dir/packaging/docker/Dockerfile" \
    -t "$image" \
    "$repo_dir"
fi

uid="$(docker run --rm --entrypoint id "$image" -u)"
[ "$uid" != "0" ] || fail "image runs as root"

version="$(docker run --rm "$image" --version)"
[ -n "$version" ] || fail "journal-bastion --version returned no value"
if [ -n "${EXPECTED_VERSION:-}" ] && [ "$version" != "$EXPECTED_VERSION" ]; then
  fail "journal-bastion version was $version instead of $EXPECTED_VERSION"
fi

mongodb_version="$(docker run --rm --entrypoint mongodb-mcp-server "$image" --version)"
[ "$mongodb_version" = "2.1.0" ] || \
  fail "mongodb-mcp-server version was $mongodb_version instead of 2.1.0"

temporal_version="$(docker run --rm --entrypoint temporal "$image" --version)"
grep -q 'temporal version 1.8.2' <<<"$temporal_version" || \
  fail "temporal CLI version was unexpected: $temporal_version"

tcld_version="$(docker run --rm --entrypoint tcld "$image" version)"
grep -q '"Version": "v0.55.0"' <<<"$tcld_version" || \
  fail "tcld version was unexpected: $tcld_version"

toolbox_version="$(docker run --rm --entrypoint toolbox "$image" --version)"
grep -q '1.10.0' <<<"$toolbox_version" || \
  fail "toolbox version was unexpected: $toolbox_version"

temporal_mcp_version="$(docker run --rm --entrypoint journal-temporal-mcp "$image" --version)"
[ "$temporal_mcp_version" = "0.1.0" ] || \
  fail "journal-temporal-mcp version was $temporal_mcp_version instead of 0.1.0"

readonly_mtls_output="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docker-contract","version":"1.0.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"inspect","arguments":{"operation":"cluster.health","args":[]}}}' | \
    docker run --rm --read-only -i \
      --entrypoint journal-temporal-mcp \
      -e TEMPORAL_TLS_CERT_DATA=$'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----' \
      -e TEMPORAL_TLS_KEY_DATA=$'-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----' \
      -e TEMPORAL_NAMESPACE=journal-test.a1b2c \
      -e TEMPORAL_ADDRESS=journal-test.a1b2c.tmprl.cloud:7233 \
      "$image"
)"
grep -q 'invalid TLS config' <<<"$readonly_mtls_output" || \
  fail "read-only mTLS probe did not reach Temporal CLI"
if grep -Eq 'EACCES|EROFS|journal-temporal-mtls' <<<"$readonly_mtls_output"; then
  fail "mTLS probe attempted to materialize credentials on a read-only filesystem"
fi

exposed_ports="$(docker image inspect "$image" --format '{{json .Config.ExposedPorts}}')"
[ "$exposed_ports" = "null" ] || fail "image exposes ports: $exposed_ports"

partial_secret="fixture-api-secret-not-for-production"
set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e DATADOG_API_KEY="$partial_secret" \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "partial Datadog config unexpectedly succeeded"
grep -q 'DATADOG_APP_KEY' <<<"$partial_output" || \
  fail "partial Datadog error did not name the missing application key"
if grep -q "$partial_secret" <<<"$partial_output"; then
  fail "partial Datadog error leaked the configured secret"
fi

set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e TEMPORAL_TLS_CERT_DATA=$'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----' \
  -e TEMPORAL_NAMESPACE=journal-test.a1b2c \
  -e TEMPORAL_ADDRESS=journal-test.a1b2c.tmprl.cloud:7233 \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "partial Temporal mTLS config unexpectedly succeeded"
grep -q 'TEMPORAL_TLS_KEY_DATA' <<<"$partial_output" || \
  fail "partial Temporal mTLS error did not name the missing key data"

set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e TEMPORAL_API_KEY="$partial_secret" \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "partial Temporal config unexpectedly succeeded"
grep -q 'TEMPORAL_ADDRESS' <<<"$partial_output" || \
  fail "partial Temporal error did not name the missing address"
if grep -q "$partial_secret" <<<"$partial_output"; then
  fail "partial Temporal error leaked the configured secret"
fi

set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e MYSQL_CONNECTION_STRING="mysql://readonly:${partial_secret}@mysql/analytics" \
  -e MYSQL_HOST=mysql \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "ambiguous MySQL config unexpectedly succeeded"
grep -q 'configuration is ambiguous' <<<"$partial_output" || \
  fail "ambiguous MySQL error was not reported"
if grep -q "$partial_secret" <<<"$partial_output"; then
  fail "ambiguous MySQL error leaked the configured secret"
fi

set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e POSTHOG_PERSONAL_API_KEY="$partial_secret" \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "partial PostHog config unexpectedly succeeded"
grep -q 'POSTHOG_PROJECT_ID' <<<"$partial_output" || \
  fail "partial PostHog error did not name the missing project id"
if grep -q "$partial_secret" <<<"$partial_output"; then
  fail "partial PostHog error leaked the configured secret"
fi

set +e
partial_output="$(docker run --rm \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e MDB_MCP_CONNECTION_STRING= \
  "$image" 2>&1)"
partial_status=$?
set -e
[ "$partial_status" -ne 0 ] || fail "partial MongoDB config unexpectedly succeeded"
grep -q 'MDB_MCP_CONNECTION_STRING' <<<"$partial_output" || \
  fail "partial MongoDB error did not name the missing connection string"

container_name="journal-bastion-sigterm-$RANDOM"
docker run -d \
  --name "$container_name" \
  --read-only \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e JOURNAL_BASTION_URL=ws://127.0.0.1:9 \
  -e MDB_MCP_CONNECTION_STRING=mongodb://127.0.0.1:27017/fixture \
  "$image" >/dev/null

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 2
mongodb_policy_output="$(docker logs "$container_name" 2>&1)"
for disabled_tool in connect disconnect export; do
  grep -q "Prevented registration of $disabled_tool" <<<"$mongodb_policy_output" || \
    fail "MongoDB $disabled_tool tool was not disabled"
done
docker stop --time 5 "$container_name" >/dev/null
exit_code="$(docker inspect "$container_name" --format '{{.State.ExitCode}}')"
[ "$exit_code" = "0" ] || fail "SIGTERM exit code was $exit_code"

echo "Docker contract passed: image=$image uid=$uid version=$version mongodb=$mongodb_version temporal=1.8.2 tcld=0.55.0"
