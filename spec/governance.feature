Feature: Governance
  Organizations enforce tool, MCP, sandbox, and budget rules across a project
  hierarchy. Policies and budgets are scoped resources that resolve into an
  effective policy and gate sessions before runtime execution.

  # ── Resolution and enforcement (domain: business rules, cheapest layer) ──

  @governance/policy-hierarchy @domain
  Scenario: Resolve the policy hierarchy most-restrictive-wins
    Given organization, team, and project policies exist
    When the effective policy is resolved for a caller and their team memberships
    Then levels are ordered organization, applicable teams, then project
    And deny rules and deny or approval lists form the union of all applicable levels
    And allow lists intersect while an omitted allow list adds no constraint
    And false booleans, restrictive states, and deny-by-default remain sticky from broader levels
    And numeric limits take the minimum and otherwise more-specific scalar values win
    And nested objects shallow-merge in level order
    And the most specific level is reported as the effective source

  @governance/model-budget @domain
  Scenario: Enforce a model budget before provider execution
    Given a project has a budget for a token, cost, session, or time window
    When recorded usage in the matching window would exceed the limit
    Then the call is denied with a budget policy category before provider execution
    And budgets scoped to a different provider or model are skipped

  @governance/platform-daily-budget @usecase
  Scenario: Cap hosted model spend per day across the platform and per organization
    Given the operator sets a daily hosted model spend limit for the platform and for each organization
    When the recorded spend of the current UTC day reaches either limit
    Then creating a cloud session is denied with a budget policy category
    And a queued cloud turn settles its session as errored without starting a sandbox or calling a model
    And self-hosted sessions are not limited
    And hosted work is allowed again when the next UTC day starts

  @governance/sandbox-restrictions @domain
  Scenario: Enforce sandbox networking and command restrictions
    Given a project sets sandbox enablement, network, host, and command policy
    When a runtime sandbox command or network operation is evaluated
    Then a disabled sandbox, blocked host, or blocked command is denied with its rule
    And the session environment network policy further restricts allowed hosts

  # ── Policy management (usecase: validation and scoping branches) ──

  @governance/policy-create @usecase
  Scenario: Create a scoped governance policy
    Given an organization admin is authenticated
    When the admin creates a tool, MCP, or sandbox policy for a scope
    Then the policy is stored for that scope after scope validation
    And a duplicate scope is rejected with the existing policy id

  @governance/policy-replace @usecase
  Scenario: Replace a policy document while keeping its scope immutable
    Given a policy exists at a scope
    When the admin replaces the policy document
    Then omitted policy objects reset and present objects are applied
    And changing the scope is rejected as immutable

  @governance/budget-create @usecase
  Scenario: Create a budget with scope validation
    Given project budgets are enabled
    When the admin creates a project, provider, or model budget
    Then the budget is stored after scope validation
    And a provider or model budget without its identifier is rejected

  @governance/budget-update @usecase
  Scenario: Update a budget by merging present fields
    Given a budget exists
    When the admin patches some budget fields
    Then present fields are merged and the rest are preserved

  @governance/effective-policy @usecase
  Scenario: Read effective policy with an optional provider and model decision
    Given organization, team, and project policies and budgets exist
    When the admin reads effective policy, optionally for a provider and model
    Then the merged tool, MCP, and sandbox policy and enabled budgets are listed
    And a provider-and-model request attaches a decision and audits the evaluation
    And the policy can be resolved as a member of a requested team

  # ── API contract (api: assembled server, tenancy, validation) ──

  @governance/budget-api @api
  Scenario: Manage budgets through the control plane
    Given a signed-in admin
    When the admin creates, reads, lists, patches, and deletes budgets
    Then budgets default to enabled and never expose a status field
    And provider- and model-scoped budgets require their identifier

  @governance/policy-change-current @usecase
  Scenario: New policy applies to later effective resolution
    Given a session was created under an older policy
    When governance policy changes
    Then later effective-policy resolution reflects the current policy and team scope
    And historical policy records are not rewritten in place
