import type { Sandbox } from '@cloudflare/sandbox'

export interface Env {
  DB: D1Database
  AUTH_CLIENT_RATE_LIMITER: RateLimit
  AUTH_IP_RATE_LIMITER: RateLimit
  AI: Ai
  ASSETS: Fetcher
  SANDBOX: DurableObjectNamespace<Sandbox>
  // The per-session Session DO (idFromName(sessionId)): event store + browser WebSocket hub.
  SESSION: DurableObjectNamespace
  // The per-environment runner pool DO (idFromName(environmentId)): self-hosted runner channel + dispatch.
  RUNNER_POOL: DurableObjectNamespace
  // Cold archive for ended cloud sessions: one events.jsonl object per session.
  SESSION_EVENTS: R2Bucket
  // Cloud session turn queue; absent in test mode where turns run inline.
  CLOUD_TURNS?: Queue<unknown>
  // Wake-up queue for durable HTTP trigger runs. D1 owns FIFO and run state.
  TRIGGER_DISPATCHES?: Queue<unknown>
  RUNTIME_MODE?: string
  // Operator switch for the hosted cloud sandbox. Only the exact value 'true'
  // allows cloud sessions to start or run turns; any other value (or none)
  // leaves self-hosted runners as the only execution path. Test mode is always on.
  CLOUD_SANDBOX_ENABLED?: string
  // Daily (UTC) ceilings on hosted model spend in cost micros, for all tenants
  // together and for each organization. Unset means unlimited.
  PLATFORM_DAILY_COST_LIMIT_MICROS?: string
  ORGANIZATION_DAILY_COST_LIMIT_MICROS?: string
  VAULT_ENCRYPTION_KEY?: string
  // AI Gateway name for third-party ({vendor}/{model}) cloud models (Unified
  // Billing / BYOK); defaults to 'enbor'. '@cf/' models stay gateway-free.
  AI_GATEWAY_ID?: string
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  // Realmroot management Resource used when exchanging the current User's Enbor
  // grant for the agents:write audience.
  REALMROOT_MANAGEMENT_RESOURCE?: string
  // Inbox protected-resource base used by the Enbor service identity to manage
  // Trigger-owned Subscriptions through PUT/DELETE /subscriptions/{id}.
  INBOX_RESOURCE?: string
  // Dedicated Realmroot machine Application used only for Inbox Subscription
  // management through the client_credentials grant.
  INBOX_CLIENT_ID?: string
  INBOX_CLIENT_SECRET?: string
  // Exact Realmroot protected-resource audience accepted by the API. Required
  // outside the explicit E2E test gate.
  OIDC_RESOURCE?: string
  OIDC_BROWSER_SCOPES?: string
  WEB_SESSION_ENCRYPTION_KEY?: string
  OIDC_RUNNER_CLIENT_ID?: string
  OIDC_RUNNER_SCOPES?: string
  ALLOWED_ORIGINS?: string
  E2E_TEST_AUTH?: string
  E2E_FAKE_REALMROOT_ENROLLMENT?: string
}
