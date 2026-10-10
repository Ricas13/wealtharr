# Private Oracle staging: PR #25

This is a deployment procedure, not a deployment record or commercial approval.
Keep the preserved `staging/pr25-ci1042-20261010` checkpoint at
`488c2973f92534c940d0c0ed0ece2f0d96c7d7be`. Do not deploy an unverified feature
head: set `RELEASE_SHA` to the exact commit whose full CI and engineering review
have passed. The completion checklist records remaining blockers.

## Private-access requirement

The Traefik overlay now **requires** `WEALTHARR_STAGING_ALLOWLIST` containing
one or more trusted reviewer/VPN source CIDRs. Replace the placeholder in the
fresh environment example with real CIDRs, such as a VPN egress address in
`X.X.X.X/32` form. Never set `0.0.0.0/0` or `::/0`. Behind another CDN
or forwarding proxy, the peer IP seen by Traefik may not be the reviewer's;
verify the observed source and enforce access at the appropriate trusted edge.
Test from an approved network AND a disallowed external network before signing
off. A public domain and TLS certificate alone do not make staging private.

## Clone and bootstrap (Oracle host)

The existing Traefik installation must have `websecure`, certificate resolver
`le`, and external Docker network `media_net`. DNS for `wealtharr.vpn4u.cc`
must point to the host. Use Docker Compose supporting `!reset` (2.24.4+).
Before starting the app, restrict the staging hostname to the intended reviewers
using the existing VPN or a Traefik IP allowlist. Verify access is denied from
outside that boundary. HTTPS, disabled checkout and `noindex` do not make a
publicly routed application private.

```sh
set -eu
git clone https://github.com/Ricas13/wealtharr.git
cd wealtharr
git fetch origin
RELEASE_SHA='<exact-reviewed-CI-passing-commit>'
git checkout --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
docker network inspect media_net >/dev/null
umask 077
test ! -e .env.production
DB_PASSWORD=$(openssl rand -hex 32)
APP_DB_PASSWORD=$(openssl rand -hex 32)
BACKUP_DB_PASSWORD=$(openssl rand -hex 32)
cat > .env.production <<EOF
WEALTHARR_STAGING_ALLOWLIST=<YOUR_TRUSTED_PUBLIC_IP_OR_VPN_CIDR>
POSTGRES_PASSWORD=$DB_PASSWORD
APP_DB_PASSWORD=$APP_DB_PASSWORD
BACKUP_DB_PASSWORD=$BACKUP_DB_PASSWORD
DATABASE_URL=postgresql://wealtharr_app:$APP_DB_PASSWORD@db:5432/strategyos
AUTH_SECRET=$(openssl rand -hex 32)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=https://wealtharr.vpn4u.cc
NEXT_PUBLIC_BRAND_NAME=Wealtharr
PUBLIC_INDEXING_ENABLED=false
WEALTHARR_PAID_LAUNCH_ENABLED=false
MARKET_DATA_MODE=PROVIDER
MARKET_DATA_PROVIDER=unconfigured
EOF
unset DB_PASSWORD APP_DB_PASSWORD BACKUP_DB_PASSWORD
chmod 600 .env.production
```

The fresh-file check is mandatory: never regenerate bootstrap keys on an
existing deployment. Securely back up this file separately from database dumps.
It is excluded from Git and the Docker build context. No provider credentials
are needed for liveness or first-run setup. Missing data must produce a blocked
action, never fabricated prices. Email-dependent customer workflows remain
unavailable until a real provider is configured; first-admin setup is local.

```sh
dc() { docker compose --env-file .env.production -f docker-compose.oracle.yml -f docker-compose.traefik.yml "$@"; }
dc config --quiet
dc build app maintenance
dc up -d db
dc --profile maintenance run --rm maintenance npm run db:migrate
dc --profile maintenance run --rm maintenance npm run db:migrate
dc --profile maintenance run --rm maintenance npm run db:seed
dc --profile maintenance run --rm maintenance npm run db:provision-roles
dc --profile maintenance run --rm maintenance npm run db:verify-roles
dc up -d app scheduler
dc ps
curl --fail --silent --show-error https://wealtharr.vpn4u.cc/api/health
dc logs --tail=100 app
```

Read the one-time setup code privately from the app log. Open
`https://wealtharr.vpn4u.cc/setup`, create the first administrator, then sign in
and open `/admin/configuration`. Enrol administrator MFA before enforcing it.

## Existing installation: safe credential cutover

**Do not run the fresh bootstrap block again on an existing Wealtharr installation.**
Never regenerate `.env.production`, AUTH_SECRET, APP_ENCRYPTION_KEY or CRON_SECRET,
and do not wipe the database volume. Keep the previously working image available.
First take a restorable database dump and a secure copy of the env file.
Generate only two additional long random hexadecimal passwords
(`APP_DB_PASSWORD`, `BACKUP_DB_PASSWORD`), add them to the existing private
environment file and stop the scheduler. Build the new maintenance image.
Run migrations twice, seed, role provisioning and role verification through
`dc --profile maintenance run --rm maintenance npm run <script>` as in the
fresh-install sequence. If any step fails, do not start the new app.
The Compose configuration enforces the `wealtharr_app` DSN irrespective of
an old `DATABASE_URL` in the file. Provision roles before application startup.
`maintenance` is an opt-in one-shot service; never run it as a daemon.
Run the provisioning step again after any future schema migration.

The online app uses non-owner `wealtharr_app`; the backup container uses
read-only `wealtharr_backup`. The privileged database login is restricted
to the one-shot maintenance job and database itself. Compose scrubs the
bootstrap passwords from the running application environment. Hexadecimal
passwords avoid URL escaping problems.

## Automated smoke checks

After deployment and a successful exact-head CI run, run this from the checkout
on Oracle:

```sh
export EXPECTED_RELEASE_SHA='<paste-the-exact-green-CI-commit>'
sh scripts/verify-private-staging.sh
```

This checks the checked-out SHA, Compose validity, running containers, restricted
database credentials, off-mode launch/indexing flags, health endpoints, database
role permissions and absence of a published PostgreSQL port. It is read-only
except a no-op zero-row permissions probe. It does NOT prove external allowlist
enforcement, off-site backup recovery, actual provider delivery, UI persistence
or regulatory approval. Record its output and complete those remaining checks.

## Configuration and acceptance

1. Verify branding/public origin and keep search indexing and paid launch off.
2. Enrol all admins in MFA; enforce the MFA setting.
3. Configure transactional email; test actual delivery and password recovery.
4. Review plans/prices without enabling paid launch. Configure Stripe sandbox
   credentials and signed webhooks, then independently test the billing lifecycle.
5. Configure licensed current/history providers only with appropriate rights.
   Verify timestamps, currencies, adjustments and outage behavior.
6. Review strategy source cards and immutable versions; add independently
   verified complete instrument mappings. Research profiles stay disabled.
7. Configure customer notification channels, retry handling and worker budgets.
8. Configure encrypted off-site backups and rehearse a scratch restore.

Verify `/setup` closes after bootstrap; unauthenticated admin/API requests fail;
the database has no published host port; scheduler starts after app health; no
unverified strategy is offered; absent prices produce DATA_REQUIRED; checkout
stays disabled; persisted settings survive app restart. Test actual fills,
duplicate submissions and review completion on a designated test account.

Inspect protected worker health without printing the bearer token:

```sh
dc exec -T app node -e 'fetch("http://127.0.0.1:3000/api/cron/health",{headers:{authorization:"Bearer "+process.env.CRON_SECRET}}).then(async r=>{console.log(r.status,await r.text())})'
```

Unconfigured provider/backup health may report degraded in private staging.
Record the missing integration explicitly; do not turn on manual mode or mark
commercial attestations complete merely to make health reports green.

## Upgrade, backup and rollback

Before upgrading, record `git rev-parse HEAD`, preserve the prior app image with
a release tag, and take a database dump to a protected directory:

```sh
umask 077
mkdir -p backups
dc exec -T db pg_dump -U strategyos -d strategyos -Fc > "backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).pgcustom"
```

Copy backups to the configured encrypted off-site repository using
`scripts/backup-postgres.sh` and verify a separate scratch restore using
`scripts/restore-drill.sh`. A local dump is not an off-site restore drill.
A scratch restore needs CREATE DATABASE privileges; perform it with separate,
authorised maintenance credentials on a scratch database. Never elevate the
long-running read-only backup service to perform restoration.

Enable the optional backup container only after configuring and initializing
its restic repository and credentials (`dc --profile backups up -d backup`).

For an additive-schema rollback, check out the prior tested commit and rebuild
the app (or restore its retained image), then `dc up -d app scheduler` and repeat
health checks. Do not down/drop the database, remove volumes, rewrite applied
migrations, or regenerate encryption/session keys. A data rollback requires a
separately rehearsed restoration plan; see `ROLLOUT_AND_ROLLBACK.md`.
