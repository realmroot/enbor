Feature: Auth
  The platform delegates authentication to a configured OAuth authorization server
  and OpenID Connect provider and applies one tenant context to the control plane and
  runtime. Realmroot is the current provider, not part of the protocol contract.

  # ── OIDC claim resolution (domain: pure token-to-scope rules) ──

  @auth/oidc-claims @domain
  Scenario: Resolve a tenant scope from OIDC claims
    Given a valid provider-issued access token with OIDC claims and the exact Enbor resource audience
    When the platform resolves the request context
    Then it derives user, organization, and project context from the claims
    And deterministic runner tokens require a configured runner client
    And a token without an explicit operation scope receives no implicit owner authority
    And each control-plane operation requires its resource read or write scope

  @auth/oidc-audience @domain
  Scenario: Reject an access token issued for another resource
    Given a signed access token from the configured issuer
    When its audience does not identify the Enbor resource
    Then authentication fails closed before tenant context is resolved

  # ── Session and context API (api: assembled server, real D1) ──

  @auth/credential-mode @api
  Scenario: Select the credential mode from the verified OAuth client
    Given the authorization server issued an RFC 9068 access token for the exact Enbor resource
    When a direct Console client sends Bearer authentication or the browser sends its opaque Enbor session cookie
    Then both credentials resolve through the same exact-scope authorization context without a proof-of-possession requirement
    And an allowed OAuth client may present an ordinary Bearer token issued for the exact Enbor resource without a local client allowlist
    And sender-constrained tokens require DPoP while the runner uses Bearer and an Agent client requires a fresh DPoP proof whose key matches cnf.jkt
    And using a client through the wrong credential mode fails closed without fallback

  @auth/dpop @api
  Scenario: Require proof of possession for Agent requests
    Given the authorization server issued a DPoP-bound Agent token for the exact Enbor resource
    When the caller omits the DPoP proof, replays it, changes its method or URL, or uses another key
    Then authentication fails closed with a DPoP challenge
    And a fresh proof whose key matches cnf.jkt is accepted once

  @auth/session-current @api
  Scenario: Read the OIDC-authenticated context
    Given an authenticated user
    When the user reads the current session context
    Then the context returns user, organization, and project without the organization id
    And a browser login is represented only by an opaque HttpOnly cookie backed by an encrypted OAuth token
    And a browser login keeps the validated ID token's minimal display profile encrypted for the current-context user
    And browser session authorization, tenant, and scope context still come only from the revalidated access token

  @auth/guard @api
  Scenario: Guard protected resources against unauthenticated access
    Given the Worker app is initialized
    When an unauthenticated request calls a protected API
    Then it is rejected with 401 and the authentication_required envelope
    And no tenant data is returned

  @auth/tenancy @api
  Scenario: Scope resources by tenant and reject cross-tenant reads
    Given resources belong to a project in an organization
    When a user from another organization reads them
    Then access is rejected and identifiers never expose secrets or provider credentials

  @auth/sso-discovery @api
  Scenario: Discover an organization's sign-in methods
    Given the public Enbor configuration
    When the user requests the discovery config
    Then the confidential Enbor backend sign-in method is returned only when its client secret and session encryption key are configured
    And public configuration returns the OIDC issuer, runner client, exact resource, and runner scopes without exposing browser credentials

  @auth/callback @api
  Scenario: Complete a server-owned browser authorization response
    Given the browser created a state, nonce, and PKCE-bound authorization attempt
    When the configured provider returns a valid authorization code to the Enbor backend
    Then Enbor consumes the attempt once and authenticates the confidential client with client_secret_basic
    And Enbor stores the access token as authenticated ciphertext in D1
    And Enbor stores only the validated ID token subject, email, name, and picture as authenticated ciphertext for display
    And the browser receives only an opaque HttpOnly SameSite cookie
    And invalid, expired, replayed, or cross-browser responses fail without creating a session
    And browser authorization-attempt, authorization-response, and cookie-session mutation routes remain internal and absent from OpenAPI
    And the authenticated current-context resource remains in OpenAPI for non-browser clients

  @auth/delegated-bootstrap @api
  Scenario: Delegate first-admin bootstrap to the OIDC provider
    Given Enbor starts without local users or organizations
    Then the configured OIDC provider remains responsible for first-admin bootstrap and credential rotation
    And Enbor accepts only validated identity and authority claims for product access

  # ── Web console (web: login action and auth redirect) ──

  @auth/login-page @web
  Scenario: Render the configured-provider sign-in action and preserve the return path
    When the user opens the login page
    Then the page offers the configured provider sign-in and preserves the requested return path

  @auth/web-redirect @web
  Scenario: Redirect unauthenticated users and return after sign-in
    When an unauthenticated user opens a protected page
    Then the app redirects to login and returns to the original page after sign-in

  # ── Browser sign-in handoff (e2e: real SPA browser wiring) ──
  # Protocol completion, D1 persistence, and scope continuity live at the
  # assembled Worker integration layer in auth/callback.

  @auth/e2e-sign-in @e2e
  Scenario: Start browser sign in
    When an unauthenticated browser chooses the configured provider sign in
    Then the SPA creates a server-owned authorization attempt and navigates to that provider
    And no OAuth token is exposed to browser JavaScript or browser storage
