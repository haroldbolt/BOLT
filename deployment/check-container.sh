#!/usr/bin/env bash
set -euo pipefail
name="bolt-check-$(date +%s)-$$"
volume="$name-data"
image="$name:ci"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build --build-arg BOLT_IMAGE_STAGE=production -t "$image" .
docker volume create "$volume" >/dev/null
export BOLT_ADMIN_SETUP_TOKEN="$(openssl rand -hex 32)"
docker run -d --name "$name" -p 127.0.0.1::8080 -v "$volume:/data" \
  -e BOLT_ADMIN_SETUP_TOKEN -e BOLT_PILOT_STORE_ID=HUB_SUBA -e BOLT_PILOT_VOLUME=/data "$image" >/dev/null
check() {
  local port
  port="$(docker port "$name" 8080/tcp | head -1 | awk -F: '{print $NF}')"
  local origin="http://127.0.0.1:$port"
  curl -fsS --retry 35 --retry-delay 1 --retry-all-errors "$origin/api/v1/health" | jq -e '.status == "ok"'
  docker exec "$name" node --input-type=module -e '
    import assert from "node:assert/strict";
    const origin = "http://127.0.0.1:8080";
    const get = async path => {
      const response = await fetch(origin + path, {redirect: "error"});
      assert.equal(response.status, 200);
      return response;
    };
    assert.equal((await (await get("/api/v1/simulation")).json()).enabled, false);
    assert.deepEqual((await (await get("/api/v1/stores")).json()).map(s => s.id), ["HUB_SUBA"]);
    await get("/");
  '

}
check
docker restart -t 15 "$name" >/dev/null
check
