#!/usr/bin/env bash
set -euo pipefail
name="bolt-check-$(date +%s)-$$"
volume="$name-data"
control="$name-admin-control"
image="$name:ci"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" "$control" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build --build-arg BOLT_IMAGE_STAGE=production -t "$image" .
docker volume create "$volume" >/dev/null
docker volume create "$control" >/dev/null
export BOLT_ADMIN_INSTALLATION_ID="$name"
export BOLT_ADMIN_BOOTSTRAP_EMAIL="$name@example.invalid"
export BOLT_ADMIN_SETUP_TOKEN="$(openssl rand -hex 32)"
mounts=(-v "$volume:/data" -v "$control:/admin-control")
# One offline maintenance invocation authorizes first use. Ordinary startup never prepares a grant.
docker run --rm "${mounts[@]}" -e BOLT_ADMIN_INSTALLATION_ID -e BOLT_ADMIN_BOOTSTRAP_EMAIL "$image" \
  node --import tsx scripts/admin-bootstrap.ts prepare /data/bolt-operacion/src/data/persisted-admin-auth.json
docker run -d --name "$name" -p 127.0.0.1::8080 "${mounts[@]}" \
  -e BOLT_ADMIN_INSTALLATION_ID -e BOLT_ADMIN_SETUP_TOKEN -e BOLT_PILOT_STORE_IDS=HUB_ALAMOS,HUB_KENNEDY,HUB_SUBA "$image" >/dev/null
check() {
  local port
  port="$(docker port "$name" 8080/tcp | head -1 | awk -F: '{print $NF}')"
  local origin="http://127.0.0.1:$port"
  curl -fsS --retry 35 --retry-delay 1 --retry-all-errors "$origin/api/v1/health" | jq -e '.status == "ok"'
  docker exec "$name" node deployment/check-pilot.mjs http://127.0.0.1:8080
}
check
docker exec -e BOLT_ADMIN_BOOTSTRAP_EMAIL "$name" node --input-type=module -e '
  import { randomBytes } from "node:crypto";
  import { establishFixtureAdmin } from "./src/tests/adminBootstrapFixture.mjs";
  await establishFixtureAdmin("http://127.0.0.1:8080", process.env.BOLT_ADMIN_BOOTSTRAP_EMAIL,
    randomBytes(32).toString("hex"), process.env.BOLT_ADMIN_SETUP_TOKEN);
'
docker restart -t 15 "$name" >/dev/null
check
docker exec "$name" node --input-type=module -e '
  const status = await fetch("http://127.0.0.1:8080/api/v1/auth/status");
  if (status.status !== 200 || (await status.json()).setupState !== "closed") process.exit(1);
'
