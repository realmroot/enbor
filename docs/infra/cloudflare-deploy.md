# Cloudflare Deployment

This is an operational deployment runbook, not a product or API specification.
Observable behavior belongs in [`../../spec/`](../../spec/); architecture
decisions belong in [`../adr/`](../adr/).

GitHub Actions is limited to CI checks. Production and staging deploys run
through Cloudflare Workers Builds.

## Required Cloudflare resources

- Workers project: `any-managed-agents` (the public product and hostname remain Enbor)
- Workers AI binding: `AI`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `enbor-db-staging-v2`
- Container image built from this repository's `Dockerfile`

## OAuth 2.0 and OpenID Connect configuration

Enbor uses standard OAuth 2.0 and OpenID Connect protocols. Realmroot is the
currently configured provider; it is not part of Enbor's protocol contract.

Register these provider clients for the deployment:

- one confidential Web client for the Enbor backend;
- one machine client for Inbox subscription management; and
- one public native client for Runner loopback PKCE.

Register Enbor as the Resource Server only after its RFC 9728 discovery document
and generated OpenAPI document are live.

Required settings:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET` as a Wrangler secret
- `OIDC_RUNNER_CLIENT_ID`
- `INBOX_CLIENT_ID`
- `INBOX_CLIENT_SECRET` as a Wrangler secret
- `WEB_SESSION_ENCRYPTION_KEY` as a distinct Wrangler secret generated from
  at least 32 random bytes
- Resource audience: the exact protected Resource URL, including `/api`
- Web redirect URI: `https://<worker-host>/api/v1/auth/authorization-responses`
- Runner redirect URI: `http://127.0.0.1:49174/oauth/callback`

Configure the Web client for authorization code with PKCE and confidential
client authentication, the Runner client for public loopback authorization code
with PKCE, and the Inbox client for client credentials. Configure scopes and
permissions from the live Resource Server metadata rather than duplicating them
in this runbook.

Set secrets separately in each environment:

```bash
pnpm exec wrangler secret put OIDC_CLIENT_ID --env staging
pnpm exec wrangler secret put OIDC_CLIENT_SECRET --env staging
pnpm exec wrangler secret put INBOX_CLIENT_ID --env staging
pnpm exec wrangler secret put INBOX_CLIENT_SECRET --env staging
pnpm exec wrangler secret put WEB_SESSION_ENCRYPTION_KEY --env staging
```

Repeat without `--env staging` for production. Do not commit client secrets or
encryption keys.

Control-plane setting:

- `ALLOWED_ORIGINS`: comma-separated browser origins allowed for CORS

Rate-limit bindings must use distinct namespaces in production, staging, E2E,
and Workerd tests:

- `AUTH_CLIENT_RATE_LIMITER`
- `AUTH_IP_RATE_LIMITER`

## Runtime resources

Required bindings and variables:

- `SANDBOX`: Cloudflare Sandbox/Containers binding
- `RUNTIME_MODE=live` in deployed environments
- `AI_GATEWAY_ID`: optional Cloudflare AI Gateway id
- `CLOUD_SANDBOX_ENABLED`: set to `true` to allow hosted cloud sandbox sessions;
  any other value keeps cloud sessions and queued cloud turns refused, leaving
  self-hosted Runners as the only execution path
- `PLATFORM_DAILY_COST_LIMIT_MICROS` and `ORGANIZATION_DAILY_COST_LIMIT_MICROS`:
  daily (UTC) ceilings on hosted model spend, in cost micros, for all tenants
  together and for each organization; unset means unlimited

Build the container image from this repository's `Dockerfile`. Do not store raw
provider credentials or OAuth tokens in D1, UI state, or logs.

## Vault encryption

Set `VAULT_ENCRYPTION_KEY` as a Wrangler secret with at least 32 characters.
Plan credential rotation before changing it; existing ciphertext cannot be
recovered with a different key.

## Verification

Local browser E2E and deterministic mock smoke:

```bash
pnpm run e2e
pnpm run smoke:mock
```

Run the real smoke manually only on a host with the required runtime installed
and authenticated. It may consume external network and model quota:

```bash
pnpm run smoke:real
```

## Cloudflare build settings

- Production build command: `pnpm run build`
- Staging build command: `pnpm run build:staging`
- Production deploy command: `pnpm run db:migrate:d1:prod && pnpm exec wrangler deploy`
- Non-production branch command: `npx wrangler versions upload` (uploads a candidate without shifting production traffic)
- Root directory: repository root
- Production branch: `main`

Apply database migrations before deploy promotion:

```bash
pnpm run db:migrate:d1:staging
pnpm run db:migrate:d1:prod
```

## One-way infrastructure cutover

The public Enbor rename has not moved the production Worker, Queue, R2, or
secret bindings to new physical names. Keep deploying the legacy physical
resources declared in `wrangler.toml`; changing those names creates empty
resources without the production secrets and encrypted-data continuity.

A future physical-resource rename must be treated as a maintenance-window
migration, not as an ordinary rolling deploy.
There is no dual-read or protocol compatibility period.

For each environment, in staging first and then production:

1. Stop new trigger dispatch and Session creation. Wait until the cloud-turn and
   trigger-dispatch queues report zero backlog and no Session or Runner lease is
   active. Record those checks in the deployment log.
2. Export the D1 database and record the existing R2 object count before any
   write. The D1 database keeps its UUID and is renamed in place; do not create
   an empty replacement database.
3. Create the target resources for the environment being rehearsed. Staging
   uses `enbor-cloud-turns-staging`, `enbor-cloud-turns-staging-dlq`,
   `enbor-trigger-dispatches-staging`,
   `enbor-trigger-dispatches-staging-dlq`, and the
   `enbor-session-events-staging` bucket. Production uses
   `enbor-cloud-turns`, `enbor-cloud-turns-dlq`,
   `enbor-trigger-dispatches`, `enbor-trigger-dispatches-dlq`, and the
   `enbor-session-events` bucket. The production targets intentionally differ
   from the active legacy names in `wrangler.toml`. Copy every legacy
   Session-events object with a one-off Worker bound to both buckets, then
   compare source/destination object counts and a deterministic key-and-size
   manifest before continuing.
4. Preserve encrypted Vault data. An encryption binding cannot be renamed and
   Cloudflare never reveals its value. Before removing the legacy binding,
   deploy a one-off migration version of the existing Worker with both the old
   and new bindings, re-encrypt every credential version transactionally, and
   verify that all rows decrypt through the new binding. A newly generated key
   must never be paired with existing ciphertext without this migration.
5. Rename the D1 database in place, apply migrations, set the final Enbor
   secrets, and deploy the Enbor Worker. Route only the Enbor hostname to it.
6. Verify discovery, OpenAPI, browser sign-in, a Toolbox read and write, Runner
   registration, Session creation, and Session-event replay. Keep the drained
   legacy queues, bucket, and Worker recoverable until this verification passes;
   they must not be configured as application fallbacks.

Abort before traffic switching if any drain, backup, object-manifest, decrypt,
or staging verification check fails. Deleting legacy infrastructure is a
separate post-cutover operation after the backup-retention window.

## Durable Object migration bootstrap

The first deployment that introduces a Durable Object migration requires a
non-versioned bootstrap deployment:

```bash
pnpm run build
pnpm exec wrangler deploy
```

After that bootstrap, Workers Builds can upload new versions normally. Do not
grant Cloudflare deployment credentials to GitHub Actions unless the deployment
policy changes.
