#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${IMAGE:-journal-bastion:phase1}"

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

container_name="journal-bastion-sigterm-$RANDOM"
docker run -d \
  --name "$container_name" \
  --read-only \
  -e JOURNAL_BASTION_TOKEN=gw_fixture \
  -e JOURNAL_BASTION_URL=ws://127.0.0.1:9 \
  "$image" >/dev/null

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 1
docker stop --time 5 "$container_name" >/dev/null
exit_code="$(docker inspect "$container_name" --format '{{.State.ExitCode}}')"
[ "$exit_code" = "0" ] || fail "SIGTERM exit code was $exit_code"

echo "Docker contract passed: image=$image uid=$uid version=$version"
