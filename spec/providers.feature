Feature: Providers
  Providers are a GLOBAL model-vendor catalog (anthropic, openai, moonshotai, …),
  not per-tenant configuration. The cloud runtime dispatches every model through
  the Workers AI binding + AI Gateway, so a provider carries no credential or base
  URL — it is just the vendor a model belongs to. The catalog is populated by a
  scheduled discovery refresh (Cloudflare Workers AI search API + models.dev) and
  read by every project; access governance still decides which vendor+model a
  project's agents may use.

  # ── Pure rules (domain: no I/O) ──

  @providers/error-normalization @domain
  Scenario: Normalize provider error categories without leaking credentials
    When any provider returns authentication, rate limit, quota, overload, invalid model, or network errors
    Then the runtime records a stable normalized error type
    And retryable errors include retry metadata when available
    And user-facing messages never echo raw credential material

  @providers/catalog-parse @domain
  Scenario: Map discovered models onto vendor-attributed catalog rows
    Given a Workers AI search model or a models.dev entry
    When the catalog mapper runs
    Then the model is placed under its real vendor with the serving path derived from the id prefix
    And only tool-driving text models are kept, minus a denylist of false function_calling flags
    And id, display name, capabilities, context window, and per-token pricing are stored

  @providers/ai-gateway-routing @domain
  Scenario: Route every hosted model call through the platform AI Gateway
    Given a cloud session calls a Workers AI model or a third-party vendor model
    When the runtime dispatches the model call
    Then the call names the configured AI Gateway, or the default gateway when none is configured
    And the call is therefore visible in that gateway's logs and analytics

  # ── Lifecycle (usecase: business branches over fake ports) ──

  @providers/catalog-refresh @usecase
  Scenario: Refresh the global model catalog from discovery
    When the scheduled discovery refresh fetches the platform catalog
    Then each vendor is upserted and its models are upserted with catalog state ready
    When discovery fails or a feed is unreachable
    Then every vendor records a normalized error category without leaking credentials

  # ── API contract (api: assembled server, OpenAPI) ──

  @providers/api-catalog @api
  Scenario: Read the global model catalog over the API
    Given a signed-in user has access to a project
    When the user lists vendors, lists catalog models, reads a vendor and its models, and triggers a refresh
    Then the v1 schema reports vendor id, slug, display name, enabled, model catalog state, and timestamps
    And the catalog is shared across tenants rather than isolated per project
