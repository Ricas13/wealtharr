#!/usr/bin/env bash
# Restore an existing Wealtharr Docker/Traefik route, without touching the proxy,
# database, secrets, volumes, image, scheduler or Cloudflare.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -r .env.production ]]; then
  echo "STOP: existing .env.production not found" >&2
  exit 2
fi
if ! docker network inspect media_net >/dev/null 2>&1; then
  echo "STOP: established media_net network not found" >&2
  exit 2
fi
existing="$(docker ps -aq --filter label=com.docker.compose.project=wealtharr --filter label=com.docker.compose.service=app)"
if [[ -z "$existing" || "$existing" == *$'\n'* ]]; then
  echo "STOP: expected exactly one existing Wealtharr app under project wealtharr" >&2
  echo "No changes made; inspect: docker ps -a --filter name=wealtharr" >&2
  exit 2
fi
dc() {
  docker compose -p wealtharr --env-file .env.production \
    -f docker-compose.oracle.yml -f docker-compose.oracle-public.yml "$@"
}
dc config --format json | python3 -c '
import json,sys
config=json.load(sys.stdin)
app=config["services"]["app"]
labels=app.get("labels",{})
if app.get("ports"): raise SystemExit("STOP: public app unexpectedly has host ports")
if not {"internal","media_net"}.issubset(set(app.get("networks",{}))):
    raise SystemExit("STOP: public app lacks expected networks")
if "wealtharr.vpn4u.cc" not in labels.get("traefik.http.routers.wealtharr.rule",""):
    raise SystemExit("STOP: hostname route missing")
if labels.get("traefik.http.services.wealtharr.loadbalancer.server.port")!="3000":
    raise SystemExit("STOP: expected backend port 3000")
if str(labels.get("traefik.enable")).lower()!="true":
    raise SystemExit("STOP: Traefik labels not enabled")
if config["services"]["db"].get("ports"):
    raise SystemExit("STOP: database accidentally publishes ports")
print("OK: original public router, app network and DB isolation")
'
echo "Reattaching only existing Wealtharr app to original Traefik router..."
dc up -d --no-deps --no-build --force-recreate app
app_id="$(dc ps -q app)"
if [[ -z "$app_id" ]]; then echo "FAIL: app container missing" >&2; exit 3; fi
docker inspect "$app_id" | python3 -c '
import json,sys
app=json.load(sys.stdin)[0]
labels=app["Config"]["Labels"]
if "media_net" not in app["NetworkSettings"]["Networks"]:
    raise SystemExit("FAIL: running app not on media_net")
if "wealtharr.vpn4u.cc" not in labels.get("traefik.http.routers.wealtharr.rule",""):
    raise SystemExit("FAIL: running app missing original public router")
if app["HostConfig"].get("PortBindings"):
    raise SystemExit("FAIL: app unexpectedly published host ports")
print("OK: original Traefik route reattached to running Wealtharr app")
'
docker exec "$app_id" node -e '
(async()=>{
const r=await fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(15000)});
console.log("Wealtharr readiness:",r.status,(await r.text()).slice(0,160));
if(!r.ok)process.exitCode=1;
})().catch(e=>{console.error("Application health:",e.message);process.exitCode=1;});
'
echo "Routing restored; open https://wealtharr.vpn4u.cc/"
