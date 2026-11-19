Feature: Sessions
  A session is a tenant-scoped run of an agent version in a selected runtime.
  It snapshots its agent and environment, owns canonical events, and exposes a
  lifecycle (create, prompt, close, reopen, delete) behind Enbor endpoints only.

  # ── State rules (domain: pure, no runtime) ──

  @sessions/state-rules @domain
  Scenario: Session state governs prompts and terminality
    Given a session in a given state
    Then prompts are accepted only while the runtime is live
    And error is terminal while closed can be reopened

  @sessions/workspace-safety @domain
  Scenario: Reject unsafe workspace and secret-bearing inputs
    Given session inputs declaring repositories, mount paths, and metadata
    When the inputs are normalized
    Then path traversal, the reserved root, and absolute escapes are rejected
    And secret-looking keys and credential-bearing URLs are rejected at any depth

  # ── API contract (api: assembled server, real D1, runtime, OpenAPI) ──

	  @sessions/create @api
	  Scenario: Create a session from an active agent and environment
	    Given a project has an active agent and an active environment
	    When the user creates a session with the agent and environment
	    Then the response includes metadata uid, spec, status, connection, and runtime metadata
	    And the session stores immutable agent and environment snapshots
	    And internal placement and tenancy fields never leave the API

	  @sessions/create-explicit-inputs @api
	  Scenario: Create a session with explicit runtime and secret references
	    Given a project has an active agent and active environments
	    When the user creates a session with name, metadata, env, envFrom, volumes, and volumeMounts
	    Then those values are stored as safe references
	    And repository resources are declared in the deterministic workspace manifest
	    And raw credentials are rejected from the request body

  @sessions/create-idempotency @api
  Scenario: Retry one logical Session creation without duplicating execution
    Given a caller supplies an Idempotency-Key when creating a Session
    When the same project retries or concurrently submits the same creation
    Then every successful response identifies the same Session
    And different inputs using that key are rejected as an idempotency conflict
    And a deleted Session does not allow its key to create another Session
    And different projects may use the same key independently
    And the Session and its durable startup work are committed atomically
    And cloud startup delivery interrupted after persistence is recovered without another Session

  @sessions/runtime-default-model @api
  Scenario: Let the selected runtime choose its default model
    Given an active agent version does not pin a provider or model
    When a session is created with a compatible runtime and environment
    Then session creation succeeds without selecting a platform provider or model
    And the runtime receives no pinned provider or model requirement

  @sessions/cloud-requires-model @api
  Scenario: Require an explicit model for the Enbor cloud runtime
    Given an active agent version does not pin a provider or model
    When a session selects the Enbor cloud runtime
    Then session creation is rejected without inventing a platform provider or model

  @sessions/cloud-sandbox-switch @usecase
  Scenario: Refuse hosted cloud sandbox work while the operator has switched it off
    Given the operator has not enabled the hosted cloud sandbox
    When a session is created in a cloud environment
    Then session creation is rejected as cloud sandbox disabled without persisting a session
    And a cloud turn already queued for an existing session settles that session as errored
    And no sandbox is started and no model is called

  @sessions/live-state-refresh @web
  Scenario: Refresh a live session until its turn state settles
    Given a session detail page is showing a pending or running session
    When the runtime completes after its final event is delivered
    Then the page continues refreshing the session resource until it leaves the live state

  @sessions/secret-projection @usecase
  Scenario: Project credential secrets into runtime inputs
    Given a session references vault credentials without pinning a version
    When runtime secrets are materialized for env and workspace volumes
    Then the active credential version is resolved at dispatch time
    And envFrom expands credential data keys into runtime environment variables
    And volume items project selected secret keys to the runtime-facing names

  @sessions/identity-materialization @usecase
  Scenario: Materialize a bound Agent Identity for one session
    Given the selected agent version references an active Identity credential
    When Enbor launches the session in a cloud or self-hosted runtime
    Then an emptyDir volume declaratively seeds the credential through the existing secret boundary
    And the writable state directory is materialized by the generic workspace volume implementation
    And the provider issuer and selected Identity runtime are supplied without exposing the credential
    And neither the cloud host nor the self-hosted runner interprets provider identity state
    And only the bound credential is copied into a private Session-local writable state directory when the provider client requires one
    And the writable copy is deleted with the Session workspace
    And a revoked or missing credential fails session creation before runtime allocation

	  @sessions/memory-store-resources @api
	  Scenario: Create a session with attached memory stores
	    Given a project has an active memory store with memories
	    When the user creates a session with memory volumes and readOnly volumeMounts
    Then Enbor stores memory references in volumes and readOnly settings in volumeMounts
    And runtime materialization mounts the current memory store contents
    And memory volumeMount readOnly settings and mount paths are included in the runtime system prompt context
    And memory contents are mounted as files instead of injected into the prompt

  @sessions/reject-dependencies @api
  Scenario: Reject unavailable or unsupported session dependencies
    When a session is created against a deleted agent or environment, a disabled provider, a blocked sandbox policy, or an unsupported runtime/provider/model
    Then the request fails before any workspace, sandbox, or runner allocation
    And the error envelope identifies the unavailable or unsupported dependency
    And no session record is left in an active state

  @sessions/initial-prompt @api
  Scenario: Launch a session with an initial prompt over the API
    Given a project has an active agent and active environments
    When an external scheduler creates a session with an initial prompt and run correlation metadata
    Then the prompt is dispatched to the Enbor-owned runtime without a browser socket
    And the initial-prompt dispatch is recorded as an audit event
    And workspace resource context is supplied through the session runtime snapshot

  @sessions/prompt @api
  Scenario: Send a prompt to an active session
    Given an idle session with cloud-owned runtime state
    When the user sends a prompt through the sessions API
    Then the runtime accepts it and message, tool, sandbox, usage, lifecycle, and error events are stored in sequence
    And the session returns to idle with a result or moves to error with a safe reason
    And self-hosted prompt resumption persists the queued work item and pending session state atomically

  @sessions/close @api
  Scenario: Close and reopen a running session cooperatively
    Given a session is running
    When the user closes the session
    Then cloud-owned runtime work is cancelled and no new work starts after the cancellation boundary
    And close atomically claims the same sandbox with cleanup ownership lasting beyond one Worker invocation only when no live turn or cleanup lease exists
    And a claimed cloud close remains marked closing and cannot be reopened until exact-owner teardown is atomically finalized
    And the status becomes closed with close lifecycle and audit records
    And failed terminal sandbox cleanup releases ownership unstamped so a later maintenance pass can retry it
    And leaked cleanup skips live owners, can take over stale closing work, and stamps only its exact sandbox ownership
    And reopening atomically removes the destruction marker, starts a new generation epoch, and accepts follow-up work
    And no successful completion events are written after cancellation

  @sessions/delete @api
  Scenario: Soft-delete sessions safely
    Given a session exists
    When the user deletes the session
    Then it is absent from every product Session API
    And deleted sessions cannot be restored
    And events and immutable snapshots remain retained only as database or cold R2 history

  @sessions/list @api
  Scenario: List sessions with pagination, state, search, label selector, and date filters
    Given a project has sessions
    When the user lists sessions with a page size, state, search term, metadata label selector, and date range
    Then the response paginates with cursors and applies state, search, metadata label selector, and date filters
    And results are scoped to the signed-in project

  @sessions/auth-tenancy @api
  Scenario: Enforce auth and project tenancy for session lifecycle
    Given a session belongs to a project
    When a request without a valid session, or a user outside the project, accesses the session
    Then the request is rejected and no cross-project data is returned

  @sessions/connection @api
  Scenario: Expose live browser traffic only through the Enbor session socket
    Given a session exists in cloud or self-hosted hosting
    When a browser opens the session socket
    Then the Console exchanges its Bearer credential for a short-lived single-use socket ticket after auth and tenancy checks
    And the ticket exchange uses the Console's selected project
    And the request upgrades without placing the Realmroot access token in the URL or WebSocket protocols
    And non-WebSocket requests are rejected instead of returning runtime discovery metadata

  # ── Canonical events (api + domain: protocol normalization) ──

  @sessions/events-canonical @api
  Scenario: Normalize all runtime output into canonical session events
    Given a session runs with any supported runtime
    When the runtime emits lifecycle, message, tool, and usage activity
    Then it is stored as canonical session events read by UI, API, and session-state views
    And runtime-specific details appear only as safe metadata

  @sessions/events-query @api
  Scenario: Query session events with stable pagination and filters
    Given an Enbor-loop session has Session DO events or a self-hosted external runtime has runner-local events
    When the client lists events with limit, order, type filter, or cursor
    Then the response returns a deterministic page with sequence boundaries
    And only external-runtime self-hosted history is read through the owning runner
    And CSV and SSE views are available through content negotiation

  @sessions/tool-result-redaction @api
  Scenario: Redact sensitive tool result output
    Given a tool result emits sensitive values
    When the event is stored or streamed
    Then tool result output redacts high-confidence secret values
    And tool calls, runtime state, and control-plane references keep their original structure

  @sessions/events-hierarchy @domain
  Scenario: Preserve event hierarchy for product consumers
    Given a runtime emits nested turns, messages, tool calls, and substeps
    When Enbor stores the session events
    Then every event has a stable id and monotonically increasing sequence
    And related events share turn, message, tool-call, and span identifiers with parent references
    And sub-agent work is represented as an agent tool call whose child events reference that tool call through parentToolCallId

  # ── Web console (web: session list, detail, transcript, tool trace) ──

  @sessions/console-detail @web
  Scenario: Render session list and detail from snapshots
    Given sessions exist with agent and environment snapshots
    When the user opens the sessions list and a session detail
    Then rows and detail facts come from agent provider/model, hosting snapshots, and session runtime
    And error and closed states are surfaced without leaking detail onto table rows

  @sessions/console-transcript @web
  Scenario: Render canonical events as transcript, debug, and tool trace
    Given a session has persisted canonical events
    When the user opens the session transcript
    Then transcript renders structured message, tool, lifecycle, usage, and error rows
    And debug keeps canonical payload JSON while the tool-trace tab pairs calls with results
    And raw payloads stay out of transcript mode while tool-result redaction stays intact
