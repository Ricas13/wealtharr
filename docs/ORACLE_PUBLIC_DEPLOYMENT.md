# Oracle public HTTPS (pre-launch)

The Oracle Wealtharr instance uses the shared Traefik on `media_net` and
`wealtharr.vpn4u.cc`. Unlike the private staging overlay, this tracked public
mode permits all web visitors to reach the sign-in screen. Authentication and
administrator MFA are mandatory controls; routing alone grants no privileged
application access.

## Fix an existing public Traefik 404 after a localhost-only deployment

If an upgrade used the localhost 3001 overlay, Wealtharr's app may have lost
its media_net attachment and public router labels. Do not change Cloudflare,
DNS, certificates or Traefik. On the existing Oracle host use:

```sh
cd /opt/wealtharr
bash scripts/repair-public-routing.sh
```

This stops if there is not exactly one existing Wealtharr app and only recreates
that app using its already-built image. It does not build, migrate, reseed,
restart the database, alter secrets or change the reverse proxy.

Always use docker-compose.oracle-public.yml for this hostname, not the
separate docker-compose.oracle-localhost3001.yml host-forwarded mode.

Run from `/opt/wealtharr` using the **existing** private
`.env.production` and the reviewed release SHA. Never regenerate keys or
delete a volume to upgrade only the UI.

```sh
dc() { docker compose -p wealtharr --env-file .env.production -f docker-compose.oracle.yml -f docker-compose.oracle-public.yml "$@"; }
dc config --quiet
# Preflight: verify network and the single app identity; database has no host port.
docker network inspect media_net >/dev/null
dc config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); a=c["services"]["app"]; assert not a.get("ports"); assert "media_net" in a["networks"]; assert not c["services"]["db"].get("ports"); print("PASS: Traefik and DB isolation")'
# After checking the reviewed CI revision:
dc build app
dc up -d --no-build app scheduler
dc ps
curl -fsS https://wealtharr.vpn4u.cc/api/health
```

Do not combine `docker-compose.oracle-public.yml` with the prior untracked
`docker-compose.web.yml`, the localhost 3001 overlay, or the private Traefik
overlay. Traefik sees the same router name and hostname only when exactly one
overlay is selected. Existing custom reverse-proxy entrypoint and certresolver
names here are `websecure` / `le`, and must exist in the shared Traefik
configuration before rollout. Docker Compose `!reset` requires a compatible
Compose version.

During pre-launch, **keep** `WEALTHARR_PAID_LAUNCH_ENABLED=false` and
`PUBLIC_INDEXING_ENABLED=false` in the protected environment. Do not set
administrative credentials, webhook signing keys or bootstrap setup codes in
public pages. Enrol all administrator accounts in MFA, then require MFA before
accepting live customers.

Deploying the admin UI does not publish or sign off a strategy; the release,
golden-case, regional-instrument, data-licensing and regulatory gates remain
separate. Research entries are visible for study, never automatically
trade-enabled.
