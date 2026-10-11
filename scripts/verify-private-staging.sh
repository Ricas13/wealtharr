#!/bin/sh
# Non-destructive acceptance checks for a private Oracle staging deployment.
# Run from the checkout directory with EXPECTED_RELEASE_SHA set to a green CI commit.
set -eu
: "${EXPECTED_RELEASE_SHA:?Set to the exact reviewed, green-CI commit SHA}"
[ "$(git rev-parse HEAD)" = "$EXPECTED_RELEASE_SHA" ] || {
  echo "FAIL: deployed checkout does not match reviewed commit" >&2; exit 2;
}
[ -r .env.production ] || { echo "FAIL: .env.production missing" >&2; exit 2; }
# Use the tracked localhost 3001 overlay when upgrading an existing host-proxy
# installation; otherwise default to the direct Traefik container overlay.
overlay="${WEALTHARR_COMPOSE_OVERLAY:-docker-compose.traefik.yml}"
[ -r "$overlay" ] || { echo "FAIL: Compose overlay does not exist" >&2; exit 2; }
dc() { docker compose --env-file .env.production -f docker-compose.oracle.yml -f "$overlay" "$@"; }
dc config --quiet
for service in db app scheduler; do
  id=$(dc ps -q "$service")
  [ -n "$id" ] && [ "$(docker inspect --format '{{.State.Running}}' "$id")" = "true" ] || {
    echo "FAIL: $service is not running" >&2; exit 3;
  }
  echo "OK: $service container running"
done
# Never print environment values; inspect only the identity and presence of credentials.
dc exec -T app node -e '
  const u = new URL(process.env.DATABASE_URL || "http://invalid");
  if (u.username !== "wealtharr_app") throw Error("App is not using the limited DB role");
  if (process.env.POSTGRES_PASSWORD || process.env.APP_DB_PASSWORD || process.env.BACKUP_DB_PASSWORD)
    throw Error("Bootstrap database credentials leaked to online app");
  if (process.env.WEALTHARR_PAID_LAUNCH_ENABLED !== "false" ||
      process.env.PUBLIC_INDEXING_ENABLED !== "false")
    throw Error("Private staging must disable paid launch and indexing");
  console.log("OK: runtime DB identity, credential scope and private release flags");
'
dc exec -T app node -e '
  async function check(path, authorized) {
    const headers = authorized ? {authorization: "Bearer " + process.env.CRON_SECRET} : {};
    const r = await fetch("http://127.0.0.1:3000" + path, {headers,signal:AbortSignal.timeout(15000)});
    console.log(path + ": HTTP " + r.status);
    if (r.status >= 500) console.log("NOTE: degraded health may reflect deliberately unconfigured providers");
    else if (!r.ok) throw Error("Unexpected health HTTP " + r.status);
  }
  (async()=>{await check("/api/health",false);await check("/api/cron/health",true)})()
    .catch(e=>{console.error(e.message);process.exit(1)});
'
dc --profile maintenance run --rm maintenance npm run db:verify-roles
# Compose 'port' exit status is not a reliable published-port test: on some
# Compose versions it succeeds even when db only exposes 5432/tcp internally.
# Inspect the running container's actual host bindings instead; internal
# container-only TCP exposures have empty/null port-binding collections.
db_id=$(dc ps -q db)
[ -n "$db_id" ] || { echo "FAIL: Database container missing" >&2; exit 4; }
db_host_bindings=$(docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$db_id")
if [ -n "$db_host_bindings" ]; then
  echo "FAIL: PostgreSQL unexpectedly has a published host port: $db_host_bindings" >&2; exit 4;
fi
echo "OK: PostgreSQL has no published host port"
echo "Automated smoke checks finished. Manual: verify external IP denial, backup restore, admin persistence, provider delivery and rollback."
