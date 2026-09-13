import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptWebSessionValue, hashOpaqueValue } from '../auth/web-session-crypto'
import type { Env } from '../env'
import { registerAuthRoutes } from '../http/auth'
import { createDepsApiRouter } from '../openapi'
import { dpopHeaders, expectAuthRequired, setupOidcProvider, signIn, signInRunner, signInUser } from './auth'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const browserIssuer = 'https://identity.alias.test/api/auth'
const browserClientId = 'enbor-test'
const browserResource = 'https://enbor.realmroot.dev/api'
const browserSigningKeys = generateKeyPair('RS256', { extractable: true })
let browserClientSequence = 0

function cookieValue(response: Response, name: string) {
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`).exec(setCookie)
  return match ? `${name}=${match[1]}` : null
}

type BrowserOidcProviderOptions = {
  scope?: string
  subject?: string
  accessTokenProfile?: false
  idTokenProfile?: {
    email?: string
    name?: string
    picture?: string
  }
  accessTokenSubject?: string
  accessTokenAudience?: string
  idTokenSubject?: string
  idTokenAudience?: string
  idTokenNonce?: string
  tamperIdTokenSignature?: boolean
}

async function installBrowserOidcProvider(options: BrowserOidcProviderOptions = {}) {
  const { privateKey, publicKey } = await browserSigningKeys
  const jwk = await exportJWK(publicKey)
  Object.assign(jwk, { kid: 'browser-test-key', alg: 'RS256', use: 'sig' })
  let expectedNonce = ''
  const tokenRequests: URLSearchParams[] = []
  const tokenRequestHeaders: Headers[] = []
  const accessTokens: string[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.includes('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: browserIssuer,
        authorization_endpoint: 'https://identity.alias.test/authorize',
        token_endpoint: 'https://identity.alias.test/token',
        jwks_uri: 'https://identity.alias.test/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      })
    }
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] })
    if (url.pathname === '/token') {
      const form =
        init?.body instanceof URLSearchParams
          ? new URLSearchParams(init.body)
          : new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()))
      tokenRequests.push(form)
      tokenRequestHeaders.push(request.headers)
      const now = Math.floor(Date.now() / 1000)
      const subject = options.subject ?? 'browser_user_1'
      const scope = options.scope ?? 'openid profile email auth:read projects:read projects:write'
      const accessTokenProfile =
        options.accessTokenProfile === false
          ? {}
          : {
              email: 'browser@example.com',
              name: 'Browser User',
            }
      const accessToken = await new SignJWT({
        client_id: browserClientId,
        scope,
        ...accessTokenProfile,
        'urn:realmroot:params:oauth:org': 'browser_org_1',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'browser-test-key', typ: 'at+jwt' })
        .setIssuer(browserIssuer)
        .setAudience(options.accessTokenAudience ?? browserResource)
        .setSubject(options.accessTokenSubject ?? subject)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey)
      const idTokenProfile = options.idTokenProfile ?? { email: 'browser@example.com', name: 'Browser User' }
      let idToken = await new SignJWT({ nonce: options.idTokenNonce ?? expectedNonce, ...idTokenProfile })
        .setProtectedHeader({ alg: 'RS256', kid: 'browser-test-key', typ: 'JWT' })
        .setIssuer(browserIssuer)
        .setAudience(options.idTokenAudience ?? browserClientId)
        .setSubject(options.idTokenSubject ?? subject)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey)
      if (options.tamperIdTokenSignature) {
        const [header, payload, signature] = idToken.split('.') as [string, string, string]
        idToken = `${header}.${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
      }
      accessTokens.push(accessToken)
      return Response.json({
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope,
      })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    tokenRequests,
    tokenRequestHeaders,
    accessTokens,
    setExpectedNonce(value: string) {
      expectedNonce = value
    },
  }
}

async function beginBrowserSignIn(returnTo = '/agents') {
  browserClientSequence += 1
  const response = await SELF.fetch('https://example.com/api/v1/auth/authorization-attempts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://example.com',
      'cf-connecting-ip': `198.51.100.${browserClientSequence}`,
    },
    body: JSON.stringify({ returnTo }),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { authorizationUrl: string }
  const loginCookie = cookieValue(response, '__Host-enbor_login')
  expect(loginCookie).toBeTruthy()
  return { response, authorizationUrl: new URL(body.authorizationUrl), loginCookie: loginCookie! }
}

async function completeBrowserSignIn(authorizationUrl: URL, loginCookie: string) {
  const callback = new URL('https://example.com/api/v1/auth/authorization-responses')
  callback.searchParams.set('code', 'browser-code')
  callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!)
  return SELF.fetch(callback, { headers: { cookie: loginCookie }, redirect: 'manual' })
}

async function establishBrowserSession() {
  const provider = await installBrowserOidcProvider()
  const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
  provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
  const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)
  expect(callback.status).toBe(302)
  const sessionCookie = cookieValue(callback, '__Host-enbor_session')
  expect(sessionCookie).toBeTruthy()
  return sessionCookie!
}

async function signedBrowserAccessToken(subject: string) {
  const { privateKey } = await browserSigningKeys
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    client_id: browserClientId,
    scope: 'openid profile email auth:read projects:read projects:write',
    email: `${subject}@example.com`,
    name: `Subject ${subject}`,
    'urn:realmroot:params:oauth:org': 'browser_org_1',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'browser-test-key', typ: 'at+jwt' })
    .setIssuer(browserIssuer)
    .setAudience(browserResource)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
}

async function jsonFetch(
  path: string,
  authorization?: string,
  init?: { method?: string; body?: unknown; headers?: HeadersInit },
) {
  const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET')
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authorization ? dpopHeaders(authorization, method, path) : {}),
      ...init?.headers,
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

describe('[CF] auth v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the OIDC discovery config publicly [spec: auth/sso-discovery]', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      methods: [{ type: 'oidc', issuer: 'https://identity.alias.test/api/auth', clientId: 'enbor-test' }],
    })
  })

  it.each([
    ['a missing client secret', { OIDC_CLIENT_SECRET: undefined }],
    ['a missing session encryption key', { WEB_SESSION_ENCRYPTION_KEY: undefined }],
    ['a short session encryption key', { WEB_SESSION_ENCRYPTION_KEY: 'too-short' }],
  ])('does not advertise browser OIDC with %s', async (_case, override) => {
    const routes = registerAuthRoutes(createDepsApiRouter())
    const bindings = {
      OIDC_ISSUER: browserIssuer,
      OIDC_CLIENT_ID: browserClientId,
      OIDC_CLIENT_SECRET: 'test-confidential-client-secret',
      WEB_SESSION_ENCRYPTION_KEY: 'test-web-session-encryption-key-with-32-characters',
      ...override,
    } as unknown as Env

    const response = await routes.request('/config', {}, bindings)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ methods: [] })
  })

  it('publishes RFC 9728 Realmroot resource metadata with the exact Enbor scope catalog [spec: api-contracts/resource-discovery]', async () => {
    const res = await SELF.fetch('https://hostile.example/.well-known/oauth-protected-resource/api')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      resource: 'https://enbor.realmroot.dev/api',
      authorization_servers: ['https://identity.alias.test/api/auth'],
      scopes_supported: [
        'agents:read',
        'agents:write',
        'audit-records:read',
        'audit-records:write',
        'auth:read',
        'auth:write',
        'budgets:read',
        'budgets:write',
        'connectors:read',
        'connectors:write',
        'environments:read',
        'environments:write',
        'identities:read',
        'identities:write',
        'leases:read',
        'leases:write',
        'memory-stores:read',
        'memory-stores:write',
        'projects:read',
        'projects:write',
        'providers:read',
        'providers:write',
        'runners:read',
        'runners:write',
        'sessions:read',
        'sessions:write',
        'triggers:read',
        'triggers:write',
        'usage-records:read',
        'usage-records:write',
        'usage-summary:read',
        'usage-summary:write',
        'vaults:read',
        'vaults:write',
        'work-items:read',
        'work-items:write',
      ],
      bearer_methods_supported: ['header'],
      resource_name: 'Enbor API',
      dpop_signing_alg_values_supported: ['ES256'],
      dpop_bound_access_tokens_required: false,
      realmroot_client_authentication: {
        console: 'bearer',
        runner: 'bearer',
        agent: 'dpop',
      },
    })
  })

  it('links the Enbor resource root to the canonical OpenAPI service description', async () => {
    const res = await SELF.fetch('https://alias.example/api')
    expect(res.status).toBe(200)
    expect(res.headers.get('link')).toBe(
      '<https://enbor.realmroot.dev/api/v1/openapi.json>; rel="service-desc"; type="application/openapi+json"',
    )
    await expect(res.json()).resolves.toMatchObject({ resource: 'https://enbor.realmroot.dev/api' })
  })

  it('exposes public browser config through configz', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/configz')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      version: 1,
      service: {
        name: 'Enbor',
        origin: 'https://example.com',
      },
      auth: {
        oidc: {
          issuer: 'https://identity.alias.test/api/auth',
          resource: 'https://enbor.realmroot.dev/api',
          runner: {
            clientId: 'enbor-runner-test',
            scopes: ['openid', 'profile', 'email', 'offline_access'],
          },
        },
      },
    })
  })

  it('accepts an organization hint on the discovery config', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config?organization=example-org')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { methods: unknown[] }
    expect(body.methods).toHaveLength(1)
  })

  it('reads the current session context from a Console Bearer credential [spec: auth/session-current] [spec: auth/credential-mode]', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/auth/sessions/current', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string }; project: Record<string, unknown> }
    expect(body).toMatchObject({
      user: { id: expect.stringMatching(/^user_e2e_/) },
      organization: { id: expect.stringMatching(/^org_e2e_/) },
      project: { name: 'Default' },
    })
    expect(body.project).not.toHaveProperty('organizationId')
  })

  it('requires authentication for the current session context [spec: auth/guard]', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions/current')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('rejects a Console token presented as DPoP [spec: auth/credential-mode]', async () => {
    const authorization = (await signIn()).replace(/^Bearer /, 'DPoP ')
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: {
        ...dpopHeaders(authorization, 'GET', '/api/v1/auth/sessions/current'),
      },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^DPoP /)
    expectAuthRequired(await res.json())
  })

  it('accepts a runner token with Bearer on a runner resource [spec: auth/credential-mode]', async () => {
    const authorization = await signInRunner()
    const res = await jsonFetch('/api/v1/runners', authorization)
    expect(res.status).toBe(200)
  })

  it('rejects a runner token presented as DPoP [spec: auth/credential-mode]', async () => {
    const authorization = (await signInRunner()).replace(/^Bearer /, 'DPoP ')
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: dpopHeaders(authorization, 'GET', '/api/v1/auth/sessions/current'),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^DPoP /)
    expectAuthRequired(await res.json())
  })

  it('advertises both credential schemes when authentication is missing', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions/current')
    expect(res.headers.get('www-authenticate')).toBe('Bearer, DPoP algs="ES256"')
  })

  it('creates a browser-bound authorization attempt with state, nonce, and S256 PKCE [spec: auth/web-redirect]', async () => {
    await installBrowserOidcProvider()

    const { response, authorizationUrl, loginCookie } = await beginBrowserSignIn('/agents?status=active')

    expect(authorizationUrl.origin).toBe('https://identity.alias.test')
    expect(authorizationUrl.pathname).toBe('/authorize')
    expect(authorizationUrl.searchParams.get('client_id')).toBe(browserClientId)
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://example.com/api/v1/auth/authorization-responses',
    )
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizationUrl.searchParams.get('resource')).toBe(browserResource)
    expect(authorizationUrl.searchParams.get('scope')).toContain('openid')
    expect(authorizationUrl.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizationUrl.searchParams.get('nonce')).toBeTruthy()
    expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(loginCookie).toBe(`__Host-enbor_login=${authorizationUrl.searchParams.get('state')}`)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(response.headers.get('set-cookie')).toContain('Secure')

    const rows = await (env as unknown as Env).DB.prepare(
      'SELECT state_hash, encrypted_payload, return_to FROM web_authorization_attempts',
    ).all<{ state_hash: string; encrypted_payload: string; return_to: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]).toMatchObject({ return_to: '/agents?status=active' })
    expect(rows.results[0]?.state_hash).not.toBe(authorizationUrl.searchParams.get('state'))
    expect(rows.results[0]?.encrypted_payload).not.toContain(authorizationUrl.searchParams.get('nonce')!)
  })

  it.each([
    ['a backslash authority', '/\\evil.com'],
    ['a NUL control character', '/\u0000evil'],
    ['an ASCII newline', '/\nevil'],
  ])('falls back to the root return path for %s', async (_case, returnTo) => {
    await installBrowserOidcProvider()

    const { authorizationUrl } = await beginBrowserSignIn(returnTo)
    const stateHash = await hashOpaqueValue(authorizationUrl.searchParams.get('state')!)
    const attempt = await (env as unknown as Env).DB.prepare(
      'SELECT return_to FROM web_authorization_attempts WHERE state_hash = ?',
    )
      .bind(stateHash)
      .first<{ return_to: string }>()

    expect(attempt?.return_to).toBe('/')
  })

  it.each([
    ['client', false, true],
    ['IP address', true, false],
  ] as const)('returns 429 when the %s authorization limiter rejects the request', async (_case, client, address) => {
    await installBrowserOidcProvider()
    const clientLimit = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
      success: client,
    }))
    const addressLimit = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
      success: address,
    }))
    const routes = registerAuthRoutes(createDepsApiRouter())
    const bindings = {
      ...(env as unknown as Env),
      AUTH_CLIENT_RATE_LIMITER: { limit: clientLimit },
      AUTH_IP_RATE_LIMITER: { limit: addressLimit },
    } as unknown as Env
    const limited = await routes.request(
      'https://example.com/authorization-attempts',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://example.com',
          'cf-connecting-ip': '192.0.2.10',
        },
        body: JSON.stringify({ returnTo: '/agents' }),
      },
      bindings,
    )

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    await expect(limited.json()).resolves.toMatchObject({ error: { type: 'rate_limited' } })
    expect(clientLimit).toHaveBeenCalledOnce()
    expect(addressLimit).toHaveBeenCalledOnce()
  })

  it('uses a stable anonymous client cookie independently from the IP address limiter', async () => {
    await installBrowserOidcProvider()
    const clientLimit = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
      success: true,
    }))
    const addressLimit = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
      success: true,
    }))
    const routes = registerAuthRoutes(createDepsApiRouter())
    const bindings = {
      ...(env as unknown as Env),
      AUTH_CLIENT_RATE_LIMITER: { limit: clientLimit },
      AUTH_IP_RATE_LIMITER: { limit: addressLimit },
    } as unknown as Env
    const request = (cookie?: string) =>
      routes.request(
        'https://example.com/authorization-attempts',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://example.com',
            'cf-connecting-ip': '192.0.2.20',
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({ returnTo: '/agents' }),
        },
        bindings,
      )

    const first = await request()
    expect(first.status).toBe(201)
    expect(first.headers.get('retry-after')).toBeNull()
    await expect(first.clone().json()).resolves.toMatchObject({ authorizationUrl: expect.any(String) })
    const clientCookie = cookieValue(first, '__Host-enbor_auth_client')
    expect(clientCookie).toMatch(/^__Host-enbor_auth_client=[A-Za-z0-9_-]{43}$/)
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(first.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(first.headers.get('set-cookie')).toContain('Secure')

    expect((await request(clientCookie!)).status).toBe(201)
    expect((await request(`__Host-enbor_auth_client=${'A'.repeat(43)}`)).status).toBe(201)

    const clientKeys = clientLimit.mock.calls.map(([input]) => input.key)
    const addressKeys = addressLimit.mock.calls.map(([input]) => input.key)
    expect(clientKeys[1]).toBe(clientKeys[0])
    expect(clientKeys[2]).not.toBe(clientKeys[0])
    expect(new Set(addressKeys).size).toBe(1)
  })

  it.each(['missing', 'another browser'])('rejects authorization state bound to %s login cookie', async (binding) => {
    const provider = await installBrowserOidcProvider()
    const { authorizationUrl } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
    const loginCookie = binding === 'missing' ? '' : (await beginBrowserSignIn('/projects')).loginCookie

    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)

    expect(callback.status).toBe(400)
    await expect(callback.json()).resolves.toMatchObject({ error: { type: 'oidc_error' } })
    expect(provider.tokenRequests).toHaveLength(0)
    const sessions = await (env as unknown as Env).DB.prepare('SELECT COUNT(*) AS count FROM web_auth_sessions').first<{
      count: number
    }>()
    expect(sessions?.count).toBe(0)
  })

  it.each([
    ['an incorrect nonce', { idTokenNonce: 'incorrect-nonce' }],
    ['a tampered ID token signature', { tamperIdTokenSignature: true }],
    ['different access and ID token subjects', { accessTokenSubject: 'access_subject', idTokenSubject: 'id_subject' }],
    ['an incorrect access token audience', { accessTokenAudience: 'https://wrong-resource.example/api' }],
    ['an incorrect ID token audience', { idTokenAudience: 'wrong-browser-client' }],
  ] satisfies Array<
    [string, BrowserOidcProviderOptions]
  >)('rejects a token response with %s', async (_case, options) => {
    const provider = await installBrowserOidcProvider(options)
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)

    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)

    expect(callback.status).toBe(400)
    await expect(callback.json()).resolves.toMatchObject({ error: { type: 'oidc_error' } })
    expect(cookieValue(callback, '__Host-enbor_session')).toBeNull()
    const sessions = await (env as unknown as Env).DB.prepare('SELECT COUNT(*) AS count FROM web_auth_sessions').first<{
      count: number
    }>()
    expect(sessions?.count).toBe(0)
  })

  it('consumes the callback once, sets an opaque HttpOnly session, and applies the same scopes as Bearer [spec: auth/callback] [spec: auth/session-current]', async () => {
    const initialAttempts = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_authorization_attempts',
    ).first<{ count: number }>()
    const provider = await installBrowserOidcProvider()
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn('/agents')
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)

    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)

    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('https://example.com/agents')
    expect(callback.headers.get('set-cookie')).toContain('__Host-enbor_login=')
    expect(callback.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(callback.headers.get('set-cookie')).toContain('HttpOnly')
    expect(callback.headers.get('set-cookie')).not.toContain(provider.accessTokens[0]!)
    const sessionCookie = cookieValue(callback, '__Host-enbor_session')
    expect(sessionCookie).toBeTruthy()
    expect(provider.tokenRequests).toHaveLength(1)
    expect(provider.tokenRequests[0]?.get('grant_type')).toBe('authorization_code')
    expect(provider.tokenRequests[0]?.get('code')).toBe('browser-code')
    expect(provider.tokenRequests[0]?.get('code_verifier')).toBeTruthy()
    expect(provider.tokenRequests[0]?.has('client_id')).toBe(false)
    expect(provider.tokenRequests[0]?.has('client_secret')).toBe(false)
    expect(provider.tokenRequestHeaders[0]!.get('authorization')).toMatch(/^Basic /)
    const clientCredentials = atob(provider.tokenRequestHeaders[0]!.get('authorization')!.slice('Basic '.length))
      .split(':')
      .map(decodeURIComponent)
    expect(clientCredentials).toEqual([browserClientId, 'test-confidential-client-secret'])

    const cookieResponse = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie! },
    })
    const bearerResponse = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { authorization: `Bearer ${provider.accessTokens[0]}` },
    })
    expect(cookieResponse.status).toBe(200)
    expect(bearerResponse.status).toBe(200)
    const cookieBody = await cookieResponse.json()
    const bearerBody = await bearerResponse.json()
    expect(cookieBody).toEqual(bearerBody)
    expect(cookieBody).toMatchObject({
      organization: { id: 'browser_org_1', name: 'Organization browser_org_1' },
    })

    for (const authorization of ['Bearer', 'Unknown credential']) {
      const invalidDirectCredential = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
        headers: { cookie: sessionCookie!, authorization },
      })
      expect(invalidDirectCredential.status, authorization).toBe(401)
      expect(invalidDirectCredential.headers.get('www-authenticate'), authorization).toBeTruthy()
      expectAuthRequired(await invalidDirectCredential.json())
    }

    const replay = await completeBrowserSignIn(authorizationUrl, loginCookie)
    expect(replay.status).toBe(400)
    await expect(replay.clone().json()).resolves.toMatchObject({ error: { type: 'oidc_error' } })
    expect(cookieValue(replay, '__Host-enbor_session')).toBeNull()
    expect(provider.tokenRequests).toHaveLength(1)
    const attempts = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_authorization_attempts',
    ).first<{ count: number }>()
    expect(attempts?.count).toBe(initialAttempts?.count ?? 0)
  })

  it('returns the validated ID token display profile when the browser access token omits profile claims [spec: auth/callback] [spec: auth/session-current]', async () => {
    const provider = await installBrowserOidcProvider({
      accessTokenProfile: false,
      idTokenProfile: {
        email: 'id-profile@example.com',
        name: 'ID Token Profile',
        picture: 'https://images.example.com/id-profile.jpg',
      },
    })
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)

    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)

    expect(callback.status).toBe(302)
    const sessionCookie = cookieValue(callback, '__Host-enbor_session')
    expect(sessionCookie).toBeTruthy()
    const sessionIdHash = await hashOpaqueValue(sessionCookie!.split('=')[1]!)
    const row = await (env as unknown as Env).DB.prepare(
      'SELECT encrypted_profile_claims FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ encrypted_profile_claims: string }>()
    expect(row?.encrypted_profile_claims).toEqual(expect.any(String))
    expect(row?.encrypted_profile_claims).not.toContain('id-profile@example.com')
    expect(row?.encrypted_profile_claims).not.toContain('ID Token Profile')
    const current = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie! },
    })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({
      user: {
        id: 'browser_user_1',
        email: 'id-profile@example.com',
        name: 'ID Token Profile',
      },
      organization: { id: 'browser_org_1', name: 'Organization browser_org_1' },
    })
  })

  it('rejects a browser session whose access token subject changes even when an ID token profile is stored [spec: auth/callback] [spec: auth/session-current]', async () => {
    const provider = await installBrowserOidcProvider({
      idTokenProfile: { email: 'stable-profile@example.com', name: 'Stable Profile' },
    })
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)
    const sessionCookie = cookieValue(callback, '__Host-enbor_session')!
    const sessionIdHash = await hashOpaqueValue(sessionCookie.split('=')[1]!)
    const replacementAccessToken = await signedBrowserAccessToken('browser_intruder')
    await (env as unknown as Env).DB.prepare(
      'UPDATE web_auth_sessions SET encrypted_access_token = ? WHERE id_hash = ?',
    )
      .bind(
        await encryptWebSessionValue(env as unknown as Env, replacementAccessToken, `web-session:${sessionIdHash}`),
        sessionIdHash,
      )
      .run()

    const response = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    const remaining = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ count: number }>()
    expect(remaining?.count).toBe(0)
  })

  it('invalidates a browser session whose encrypted ID token profile is tampered [spec: auth/callback] [spec: auth/session-current]', async () => {
    const sessionCookie = await establishBrowserSession()
    const sessionIdHash = await hashOpaqueValue(sessionCookie.split('=')[1]!)
    const row = await (env as unknown as Env).DB.prepare(
      'SELECT encrypted_profile_claims FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ encrypted_profile_claims: string }>()
    const encrypted = JSON.parse(row!.encrypted_profile_claims) as { ciphertext: string }
    encrypted.ciphertext = `${encrypted.ciphertext.startsWith('A') ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}`
    await (env as unknown as Env).DB.prepare(
      'UPDATE web_auth_sessions SET encrypted_profile_claims = ? WHERE id_hash = ?',
    )
      .bind(JSON.stringify(encrypted), sessionIdHash)
      .run()

    const response = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    const remaining = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ count: number }>()
    expect(remaining?.count).toBe(0)
  })

  it.each([
    ['a different subject', { sub: 'browser_intruder' }],
    ['an empty subject', { sub: '' }],
  ])('invalidates a browser session whose encrypted ID token profile has %s [spec: auth/callback] [spec: auth/session-current]', async (_case, profileOverride) => {
    const sessionCookie = await establishBrowserSession()
    const sessionIdHash = await hashOpaqueValue(sessionCookie.split('=')[1]!)
    await (env as unknown as Env).DB.prepare(
      'UPDATE web_auth_sessions SET encrypted_profile_claims = ? WHERE id_hash = ?',
    )
      .bind(
        await encryptWebSessionValue(
          env as unknown as Env,
          JSON.stringify({
            ...profileOverride,
            email: 'intruder-profile@example.com',
            name: 'Intruder Profile',
          }),
          `web-session-profile:${sessionIdHash}`,
        ),
        sessionIdHash,
      )
      .run()

    const response = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    const remaining = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ count: number }>()
    expect(remaining?.count).toBe(0)
  })

  it('rejects an expired authorization attempt before exchanging its code', async () => {
    const provider = await installBrowserOidcProvider()
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
    await (env as unknown as Env).DB.prepare('UPDATE web_authorization_attempts SET expires_at = ?')
      .bind('2000-01-01T00:00:00.000Z')
      .run()

    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)

    expect(callback.status).toBe(400)
    await expect(callback.clone().json()).resolves.toMatchObject({ error: { type: 'oidc_error' } })
    expect(cookieValue(callback, '__Host-enbor_session')).toBeNull()
    expect(provider.tokenRequests).toHaveLength(0)
  })

  it('invalidates a browser session whose encrypted token is tampered', async () => {
    const sessionCookie = await establishBrowserSession()
    const sessionIdHash = await hashOpaqueValue(sessionCookie.split('=')[1]!)
    const row = await (env as unknown as Env).DB.prepare(
      'SELECT encrypted_access_token FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ encrypted_access_token: string }>()
    const encrypted = JSON.parse(row!.encrypted_access_token) as { ciphertext: string }
    encrypted.ciphertext = `${encrypted.ciphertext.startsWith('A') ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}`
    await (env as unknown as Env).DB.prepare(
      'UPDATE web_auth_sessions SET encrypted_access_token = ? WHERE id_hash = ?',
    )
      .bind(JSON.stringify(encrypted), sessionIdHash)
      .run()

    const response = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: { cookie: sessionCookie },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    const remaining = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(sessionIdHash)
      .first<{ count: number }>()
    expect(remaining?.count).toBe(0)
  })

  it('invalidates browser sessions when encrypted tokens are swapped across row AAD contexts', async () => {
    const firstCookie = await establishBrowserSession()
    const secondCookie = await establishBrowserSession()
    const firstHash = await hashOpaqueValue(firstCookie.split('=')[1]!)
    const secondHash = await hashOpaqueValue(secondCookie.split('=')[1]!)
    const first = await (env as unknown as Env).DB.prepare(
      'SELECT encrypted_access_token FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(firstHash)
      .first<{ encrypted_access_token: string }>()
    const second = await (env as unknown as Env).DB.prepare(
      'SELECT encrypted_access_token FROM web_auth_sessions WHERE id_hash = ?',
    )
      .bind(secondHash)
      .first<{ encrypted_access_token: string }>()
    await (env as unknown as Env).DB.batch([
      (env as unknown as Env).DB.prepare(
        'UPDATE web_auth_sessions SET encrypted_access_token = ? WHERE id_hash = ?',
      ).bind(second!.encrypted_access_token, firstHash),
      (env as unknown as Env).DB.prepare(
        'UPDATE web_auth_sessions SET encrypted_access_token = ? WHERE id_hash = ?',
      ).bind(first!.encrypted_access_token, secondHash),
    ])

    for (const sessionCookie of [firstCookie, secondCookie]) {
      const response = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
        headers: { cookie: sessionCookie },
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    }
    const remaining = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions WHERE id_hash IN (?, ?)',
    )
      .bind(firstHash, secondHash)
      .first<{ count: number }>()
    expect(remaining?.count).toBe(0)
  })

  it('enforces same-origin CSRF for unsafe cookie requests without applying it to Bearer callers', async () => {
    const provider = await installBrowserOidcProvider()
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn('/projects')
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)
    const sessionCookie = cookieValue(callback, '__Host-enbor_session')!
    const body = JSON.stringify({ name: 'Browser project' })

    const rejectedCookie = await SELF.fetch('https://example.com/api/v1/projects', {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json', origin: 'https://attacker.example' },
      body,
    })
    expect(rejectedCookie.status).toBe(403)

    const acceptedCookie = await SELF.fetch('https://example.com/api/v1/projects', {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json', origin: 'https://example.com' },
      body,
    })
    expect(acceptedCookie.status).toBe(201)

    const acceptedBearer = await SELF.fetch('https://example.com/api/v1/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${provider.accessTokens[0]}`,
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({ name: 'Bearer project' }),
    })
    expect(acceptedBearer.status).toBe(201)
  })

  it('deletes the D1 browser session and expires its cookie on same-origin logout', async () => {
    const initialSessionRows = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions',
    ).first<{ count: number }>()
    const provider = await installBrowserOidcProvider()
    const { authorizationUrl, loginCookie } = await beginBrowserSignIn()
    provider.setExpectedNonce(authorizationUrl.searchParams.get('nonce')!)
    const callback = await completeBrowserSignIn(authorizationUrl, loginCookie)
    const sessionCookie = cookieValue(callback, '__Host-enbor_session')!

    const logout = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      method: 'DELETE',
      headers: { cookie: sessionCookie, origin: 'https://example.com' },
    })

    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('__Host-enbor_session=')
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    const sessionRows = await (env as unknown as Env).DB.prepare(
      'SELECT COUNT(*) AS count FROM web_auth_sessions',
    ).first<{ count: number }>()
    expect(sessionRows?.count).toBe(initialSessionRows?.count ?? 0)
    expect(
      (
        await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
          headers: { cookie: sessionCookie },
        })
      ).status,
    ).toBe(401)
  })
})

describe('[CF] projects v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/projects')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists the auto-created default project without exposing organizationId [spec: auth/delegated-bootstrap]', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>
      pagination: Record<string, unknown>
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: expect.stringMatching(UUID_V7),
      name: 'Default',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(body.data[0]).not.toHaveProperty('organizationId')
    expect(body.pagination).toEqual({ limit: 50, nextCursor: null, hasMore: false })
  })

  it('creates and reads a project', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/projects', authorization, {
      body: { name: 'Control Plane' },
    })
    expect(createRes.status).toBe(201)
    const project = (await createRes.json()) as Record<string, unknown> & { id: string }
    expect(project).toMatchObject({ id: expect.stringMatching(UUID_V7), name: 'Control Plane' })
    expect(project).not.toHaveProperty('organizationId')

    const readRes = await jsonFetch(`/api/v1/projects/${project.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: project.id, name: 'Control Plane' })
  })

  it('[spec: projects/name-uniqueness] rejects duplicate names per organization while allowing the same name across organizations', async () => {
    const tenantA = await signInUser('project_unique_tenant_a')
    const first = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Shared workspace' } })
    expect(first.status).toBe(201)
    const firstProject = (await first.json()) as { id: string }

    const duplicateCreate = await jsonFetch('/api/v1/projects', tenantA, {
      body: { name: 'Shared workspace' },
    })
    expect(duplicateCreate.status).toBe(409)
    await expect(duplicateCreate.json()).resolves.toEqual({
      error: {
        type: 'conflict',
        message: 'A project named "Shared workspace" already exists in this organization',
      },
    })

    const renameTarget = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Rename target' } })
    const renameTargetProject = (await renameTarget.json()) as { id: string }
    const duplicateRename = await jsonFetch(`/api/v1/projects/${renameTargetProject.id}`, tenantA, {
      method: 'PATCH',
      body: { name: 'Shared workspace' },
    })
    expect(duplicateRename.status).toBe(409)
    await expect(duplicateRename.json()).resolves.toMatchObject({
      error: { type: 'conflict' },
    })

    const tenantB = await signInUser('project_unique_tenant_b')
    const crossTenant = await jsonFetch('/api/v1/projects', tenantB, { body: { name: 'Shared workspace' } })
    expect(crossTenant.status).toBe(201)

    const tenantC = await signInUser('project_unique_tenant_c')
    const attempts = await Promise.all([
      jsonFetch('/api/v1/projects', tenantC, { body: { name: 'Concurrent workspace' } }),
      jsonFetch('/api/v1/projects', tenantC, { body: { name: 'Concurrent workspace' } }),
    ])
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 409])
    const successfulAttempt = attempts.find((response) => response.status === 201)!
    const concurrentProject = (await successfulAttempt.json()) as { id: string }
    const stored = await env.DB.prepare(`
      SELECT name
      FROM projects
      WHERE organization_id = (SELECT organization_id FROM projects WHERE id = ?)
        AND name = ?
    `)
      .bind(concurrentProject.id, 'Concurrent workspace')
      .all<{ name: string }>()
    expect(stored.results).toEqual([{ name: 'Concurrent workspace' }])

    expect((await jsonFetch(`/api/v1/projects/${firstProject.id}`, tenantA)).status).toBe(200)
  })

  it('[spec: projects/rename] renames ordinary projects while protecting tenant and Default boundaries', async () => {
    const tenantA = await signInUser('project_rename_tenant_a')
    const initialProjects = await jsonFetch('/api/v1/projects', tenantA)
    const defaultProject = ((await initialProjects.json()) as { data: Array<{ id: string }> }).data[0]!
    const createRes = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Old workspace name' } })
    const project = (await createRes.json()) as { id: string; createdAt: string; updatedAt: string }

    const renamedRes = await jsonFetch(`/api/v1/projects/${project.id}`, tenantA, {
      method: 'PATCH',
      body: { name: 'New workspace name' },
    })
    expect(renamedRes.status).toBe(200)
    await expect(renamedRes.json()).resolves.toMatchObject({
      id: project.id,
      name: 'New workspace name',
      createdAt: project.createdAt,
      updatedAt: expect.any(String),
    })
    await expect((await jsonFetch(`/api/v1/projects/${project.id}`, tenantA)).json()).resolves.toMatchObject({
      id: project.id,
      name: 'New workspace name',
    })

    const defaultRename = await jsonFetch(`/api/v1/projects/${defaultProject.id}`, tenantA, {
      method: 'PATCH',
      body: { name: 'Renamed Default' },
    })
    expect(defaultRename.status).toBe(409)
    await expect(defaultRename.json()).resolves.toEqual({
      error: { type: 'conflict', message: 'Default project cannot be edited' },
    })

    const reservedRename = await jsonFetch(`/api/v1/projects/${project.id}`, tenantA, {
      method: 'PATCH',
      body: { name: 'Default' },
    })
    expect(reservedRename.status).toBe(409)
    await expect(reservedRename.json()).resolves.toEqual({
      error: { type: 'conflict', message: 'Default is a reserved project name' },
    })

    const invalidRename = await jsonFetch(`/api/v1/projects/${project.id}`, tenantA, {
      method: 'PATCH',
      body: { name: '' },
    })
    expect(invalidRename.status).toBe(400)
    await expect(invalidRename.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })

    const missingRename = await jsonFetch('/api/v1/projects/project_missing', tenantA, {
      method: 'PATCH',
      body: { name: 'Still missing' },
    })
    expect(missingRename.status).toBe(404)
    await expect(missingRename.json()).resolves.toEqual({
      error: { type: 'not_found', message: 'Project not found' },
    })

    const tenantB = await signInUser('project_rename_tenant_b')
    const concealedRename = await jsonFetch(`/api/v1/projects/${project.id}`, tenantB, {
      method: 'PATCH',
      body: { name: 'Cross-tenant rename' },
    })
    expect(concealedRename.status).toBe(404)
    await expect(concealedRename.json()).resolves.toEqual({
      error: { type: 'not_found', message: 'Project not found' },
    })
  })

  it('returns 404 for unknown projects', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects/project_missing', authorization)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'not_found', message: 'Project not found' },
    })
  })

  it('does not read projects across organizations [spec: auth/tenancy]', async () => {
    const tenantA = await signInUser('proj_tenant_a')
    const createRes = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Tenant A project' } })
    const project = (await createRes.json()) as { id: string }

    const tenantB = await signInUser('proj_tenant_b')
    const res = await jsonFetch(`/api/v1/projects/${project.id}`, tenantB)
    expect(res.status).toBe(404)
  })

  it('fails closed for invalid project selectors while supporting the query compatibility form [spec: api-contracts/realmroot-toolbox]', async () => {
    const tenantA = await signInUser('project_selector_tenant_a')
    const alternateCreate = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Alternate workspace' } })
    const alternate = (await alternateCreate.json()) as { id: string }
    const createdAgent = await jsonFetch('/api/v1/agents', tenantA, {
      body: {
        metadata: { name: 'Alternate project agent' },
        spec: { systemPrompt: 'Remain in the selected project.' },
      },
      headers: { 'x-enbor-project-id': alternate.id },
    })
    expect(createdAgent.status).toBe(201)
    const agent = (await createdAgent.json()) as { metadata: { uid: string } }

    const querySelected = await jsonFetch(
      `/api/v1/agents?x-enbor-project-id=${encodeURIComponent(alternate.id)}`,
      tenantA,
    )
    expect(querySelected.status).toBe(200)
    await expect(querySelected.json()).resolves.toMatchObject({
      data: [{ metadata: { uid: agent.metadata.uid } }],
    })

    for (const response of [
      await jsonFetch('/api/v1/agents', tenantA, { headers: { 'x-enbor-project-id': 'project_missing' } }),
      await jsonFetch('/api/v1/agents', tenantA, { headers: { 'x-enbor-project-id': '' } }),
      await jsonFetch('/api/v1/agents?x-enbor-project-id=project_missing', tenantA),
    ]) {
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: { type: 'not_found', message: 'Project not found' },
      })
    }

    const tenantB = await signInUser('project_selector_tenant_b')
    const foreignCreate = await jsonFetch('/api/v1/projects', tenantB, { body: { name: 'Foreign workspace' } })
    const foreignProject = (await foreignCreate.json()) as { id: string }
    const concealed = await jsonFetch('/api/v1/agents', tenantA, {
      headers: { 'x-enbor-project-id': foreignProject.id },
    })
    expect(concealed.status).toBe(404)
    await expect(concealed.json()).resolves.toEqual({
      error: { type: 'not_found', message: 'Project not found' },
    })
  })

  it('[spec: projects/delete-empty] deletes only empty projects in the caller organization', async () => {
    const tenantA = await signInUser('project_delete_tenant_a')
    const initialProjects = await jsonFetch('/api/v1/projects', tenantA)
    const defaultProject = ((await initialProjects.json()) as { data: Array<{ id: string }> }).data[0]!
    const defaultDelete = await jsonFetch(`/api/v1/projects/${defaultProject.id}`, tenantA, { method: 'DELETE' })
    expect(defaultDelete.status).toBe(409)
    await expect(defaultDelete.json()).resolves.toEqual({
      error: { type: 'conflict', message: 'Default project cannot be deleted' },
    })

    const reservedDefaultCreate = await jsonFetch('/api/v1/projects', tenantA, {
      body: { name: 'Default' },
    })
    expect(reservedDefaultCreate.status).toBe(409)
    await expect(reservedDefaultCreate.json()).resolves.toEqual({
      error: { type: 'conflict', message: 'Default is a reserved project name' },
    })

    const emptyCreate = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Empty workspace' } })
    const emptyProject = (await emptyCreate.json()) as { id: string }

    const deleted = await jsonFetch(`/api/v1/projects/${emptyProject.id}`, tenantA, { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
    expect((await jsonFetch(`/api/v1/projects/${emptyProject.id}`, tenantA)).status).toBe(404)
    expect(
      ((await (await jsonFetch('/api/v1/projects', tenantA)).json()) as { data: Array<{ id: string }> }).data.some(
        ({ id }) => id === emptyProject.id,
      ),
    ).toBe(false)
    expect(
      (
        await env.DB.prepare('SELECT deleted_at FROM projects WHERE id = ?').bind(emptyProject.id).first<{
          deleted_at: string | null
        }>()
      )?.deleted_at,
    ).toEqual(expect.any(String))
    expect(
      (
        await jsonFetch(`/api/v1/projects/${emptyProject.id}`, tenantA, {
          method: 'PATCH',
          body: { name: 'Cannot restore a tombstone' },
        })
      ).status,
    ).toBe(404)
    expect((await jsonFetch(`/api/v1/projects/${emptyProject.id}`, tenantA, { method: 'DELETE' })).status).toBe(404)

    const occupiedCreate = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Occupied workspace' } })
    const occupiedProject = (await occupiedCreate.json()) as { id: string }
    const now = '2026-09-02T00:00:00.000Z'
    await env.DB.prepare(`INSERT INTO agents (
      id, project_id, name, system_prompt, skills, subagents, allowed_tools, mcp_connectors, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '[]', '[]', '[]', '[]', ?, ?)`)
      .bind('agent_project_delete_guard', occupiedProject.id, 'Deletion guard', 'Remain attached.', now, now)
      .run()

    const occupiedDelete = await jsonFetch(`/api/v1/projects/${occupiedProject.id}`, tenantA, { method: 'DELETE' })
    expect(occupiedDelete.status).toBe(409)
    await expect(occupiedDelete.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Project still contains live resources' },
    })

    await env.DB.prepare('UPDATE agents SET deleted_at = ? WHERE id = ?').bind(now, 'agent_project_delete_guard').run()
    await env.DB.prepare(`INSERT INTO vaults (
      id, organization_id, project_id, name, scope, managed_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'project', 'identity', ?, ?)`)
      .bind(
        'vault_identity_managed_history',
        'org_project_delete_tenant_a',
        occupiedProject.id,
        'Identity internals',
        now,
        now,
      )
      .run()
    expect((await jsonFetch(`/api/v1/projects/${occupiedProject.id}`, tenantA, { method: 'DELETE' })).status).toBe(204)

    const publicVaultCreate = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Public vault project' } })
    const publicVaultProject = (await publicVaultCreate.json()) as { id: string }
    await env.DB.prepare(`INSERT INTO vaults (
      id, organization_id, project_id, name, scope, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'project', ?, ?)`)
      .bind('vault_public_delete_guard', 'org_project_delete_tenant_a', publicVaultProject.id, 'Public vault', now, now)
      .run()
    expect((await jsonFetch(`/api/v1/projects/${publicVaultProject.id}`, tenantA, { method: 'DELETE' })).status).toBe(
      409,
    )

    const tenantB = await signInUser('project_delete_tenant_b')
    expect((await jsonFetch(`/api/v1/projects/${occupiedProject.id}`, tenantB, { method: 'DELETE' })).status).toBe(404)
  })

  it('ensures exactly one Default before concurrent custom creates in a brand-new organization', async () => {
    const authorization = await signInUser('project_default_on_create')
    const [firstCreate, secondCreate] = await Promise.all([
      jsonFetch('/api/v1/projects', authorization, { body: { name: 'First workspace' } }),
      jsonFetch('/api/v1/projects', authorization, { body: { name: 'Second workspace' } }),
    ])
    expect(firstCreate.status).toBe(201)
    expect(secondCreate.status).toBe(201)
    const first = (await firstCreate.json()) as { id: string }

    const stored = await env.DB.prepare(`
      SELECT name
      FROM projects
      WHERE organization_id = (SELECT organization_id FROM projects WHERE id = ?)
      ORDER BY name
    `)
      .bind(first.id)
      .all<{ name: string }>()
    expect(stored.results).toEqual([{ name: 'Default' }, { name: 'First workspace' }, { name: 'Second workspace' }])
  })

  it('paginates the project list with cursors', async () => {
    const authorization = await signInUser('proj_paging')
    for (const name of ['Project One', 'Project Two', 'Project Three']) {
      const res = await jsonFetch('/api/v1/projects', authorization, { body: { name } })
      expect(res.status).toBe(201)
    }

    const firstPageRes = await jsonFetch('/api/v1/projects?limit=2', authorization)
    expect(firstPageRes.status).toBe(200)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(2)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const secondPageRes = await jsonFetch(
      `/api/v1/projects?limit=2&cursor=${encodeURIComponent(firstPage.pagination.nextCursor as string)}`,
      authorization,
    )
    expect(secondPageRes.status).toBe(200)
    const secondPage = (await secondPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean }
    }
    expect(secondPage.data.length).toBeGreaterThan(0)
    const firstPageIds = new Set(firstPage.data.map((row) => row.id))
    for (const row of secondPage.data) {
      expect(firstPageIds.has(row.id)).toBe(false)
    }
  })

  it('rejects invalid list cursors', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects?cursor=not-a-cursor', authorization)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid list cursor' },
    })
  })
})
