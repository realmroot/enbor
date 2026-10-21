import { and, eq, gt, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context, Env as HonoEnv } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import * as oauth from 'oauth4webapi'
import { webAuthorizationAttempts, webAuthSessions } from '../db/schema'
import type { Env } from '../env'
import { getAccessTokenClaims, OidcError, oidcAudience, requireOidcConfig, type UserInfoClaims } from './oidc'
import {
  decryptWebSessionValue,
  encryptWebSessionValue,
  hashOpaqueValue,
  hashWebSessionClientAddress,
  randomOpaqueValue,
} from './web-session-crypto'

const SESSION_COOKIE = 'enbor_session'
const ATTEMPT_COOKIE = 'enbor_login'
const AUTH_CLIENT_COOKIE = 'enbor_auth_client'
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const AUTH_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_MAX_TTL_MS = 8 * 60 * 60 * 1000
const OIDC_METADATA_TTL_MS = 10 * 60 * 1000
type WebContext<E extends HonoEnv = { Bindings: Env }> = Context<E & { Bindings: Env }>
const metadataCache = new Map<string, { metadata: OidcMetadata; expiresAt: number }>()

interface AttemptPayload {
  codeVerifier: string
  nonce: string
}

interface OidcMetadata extends oauth.AuthorizationServer {
  authorization_endpoint: string
  token_endpoint: string
}

interface WebSessionProfileClaims {
  sub: string
  email?: string
  name?: string
  picture?: string
}

export class WebSessionCsrfError extends Error {
  constructor() {
    super('Cookie-authenticated request origin is invalid')
    this.name = 'WebSessionCsrfError'
  }
}

export class WebAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebAuthorizationError'
  }
}

export class WebAuthorizationRateLimitError extends Error {
  constructor() {
    super('Too many active browser authorization attempts')
    this.name = 'WebAuthorizationRateLimitError'
  }
}

export async function createAuthorizationAttempt<E extends HonoEnv>(c: WebContext<E>, returnTo: string) {
  enforceSameOriginForUnsafeRequest(c.req.raw)
  const { clientKey, addressKey } = await authorizationRateLimitKeys(c)
  const [clientLimit, addressLimit] = await Promise.all([
    c.env.AUTH_CLIENT_RATE_LIMITER.limit({ key: clientKey }),
    c.env.AUTH_IP_RATE_LIMITER.limit({ key: addressKey }),
  ])
  if (!clientLimit.success || !addressLimit.success) throw new WebAuthorizationRateLimitError()
  const { clientId } = requireWebOidcConfig(c.env)
  const metadata = await discover(c.env)
  const state = randomOpaqueValue()
  const codeVerifier = oauth.generateRandomCodeVerifier()
  const nonce = oauth.generateRandomNonce()
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier)
  const redirectUri = callbackUri(c.req.url)
  const authorizationUrl = new URL(metadata.authorization_endpoint)
  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', browserScopes(c.env))
  authorizationUrl.searchParams.set('resource', oidcAudience(c.env, c.req.url))
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('nonce', nonce)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')

  const now = new Date()
  const db = drizzle(c.env.DB)
  const stateHash = await hashOpaqueValue(state)
  await db.delete(webAuthorizationAttempts).where(lte(webAuthorizationAttempts.expiresAt, now.toISOString()))
  await db.insert(webAuthorizationAttempts).values({
    stateHash,
    encryptedPayload: await encryptWebSessionValue(
      c.env,
      JSON.stringify({ codeVerifier, nonce } satisfies AttemptPayload),
      `authorization-attempt:${stateHash}`,
    ),
    returnTo: safeReturnTo(returnTo, c.req.url),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString(),
  })
  setCookie(
    c,
    cookieName(c.req.url, ATTEMPT_COOKIE),
    state,
    cookieOptions(c.req.url, new Date(now.getTime() + ATTEMPT_TTL_MS)),
  )
  return authorizationUrl.toString()
}

export async function completeAuthorizationResponse<E extends HonoEnv>(c: WebContext<E>) {
  const currentUrl = new URL(c.req.url)
  const state = currentUrl.searchParams.get('state')
  if (!state) throw new WebAuthorizationError('Realmroot authorization response omitted state')
  if (getCookie(c, cookieName(c.req.url, ATTEMPT_COOKIE)) !== state) {
    throw new WebAuthorizationError('Realmroot authorization response is not bound to this browser')
  }

  const db = drizzle(c.env.DB)
  const now = new Date()
  const stateHash = await hashOpaqueValue(state)
  const attempt = await db
    .delete(webAuthorizationAttempts)
    .where(
      and(eq(webAuthorizationAttempts.stateHash, stateHash), gt(webAuthorizationAttempts.expiresAt, now.toISOString())),
    )
    .returning()
    .get()
  if (!attempt) throw new WebAuthorizationError('Realmroot authorization attempt is missing, expired, or already used')
  deleteCookie(c, cookieName(c.req.url, ATTEMPT_COOKIE), cookieDeletionOptions(c.req.url))

  const payload = JSON.parse(
    await decryptWebSessionValue(c.env, attempt.encryptedPayload, `authorization-attempt:${stateHash}`),
  ) as AttemptPayload
  if (!payload.codeVerifier || !payload.nonce) throw new Error('Realmroot authorization attempt is invalid')
  const metadata = await discover(c.env)
  const { clientId, clientSecret } = requireWebOidcConfig(c.env)
  const client: oauth.Client = { client_id: clientId }
  let params: URLSearchParams
  try {
    params = oauth.validateAuthResponse(metadata, client, currentUrl, state)
  } catch {
    throw new WebAuthorizationError('Realmroot authorization response is invalid')
  }
  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    metadata,
    client,
    oauth.ClientSecretBasic(clientSecret),
    params,
    callbackUri(c.req.url),
    payload.codeVerifier,
    { signal: AbortSignal.timeout(5000) },
  )
  let tokens: oauth.TokenEndpointResponse
  try {
    tokens = await oauth.processAuthorizationCodeResponse(metadata, client, tokenResponse, {
      expectedNonce: payload.nonce,
      requireIdToken: true,
    })
    await oauth.validateApplicationLevelSignature(metadata, tokenResponse, { signal: AbortSignal.timeout(5000) })
  } catch {
    throw new WebAuthorizationError('Realmroot token response is invalid')
  }
  const claims = oauth.getValidatedIdTokenClaims(tokens)
  if (!claims?.sub) throw new WebAuthorizationError('Realmroot ID token omitted subject')
  let accessClaims: UserInfoClaims
  try {
    accessClaims = await getAccessTokenClaims(c.env, tokens.access_token, oidcAudience(c.env, c.req.url))
  } catch {
    throw new WebAuthorizationError('Realmroot access token is invalid')
  }
  if (accessClaims.sub !== claims.sub) throw new WebAuthorizationError('Realmroot token subjects do not match')

  if (!tokens.expires_in) throw new WebAuthorizationError('Realmroot access token response omitted expiration')
  const tokenExpiry = now.getTime() + tokens.expires_in * 1000
  const expiresAt = new Date(Math.min(tokenExpiry, now.getTime() + SESSION_MAX_TTL_MS))
  await persistWebSession(c, claims.sub, tokens.access_token, profileClaims(claims), expiresAt)
  return attempt.returnTo
}

export async function createE2eWebSession<E extends HonoEnv>(c: WebContext<E>, accessToken: string) {
  if (c.env.E2E_TEST_AUTH !== 'true' || c.env.RUNTIME_MODE !== 'test') {
    throw new Error('E2E browser sessions are unavailable')
  }
  const claims = await getAccessTokenClaims(c.env, accessToken, oidcAudience(c.env, c.req.url))
  await persistWebSession(c, claims.sub, accessToken, profileClaims(claims), new Date(Date.now() + SESSION_MAX_TTL_MS))
}

async function persistWebSession<E extends HonoEnv>(
  c: WebContext<E>,
  subject: string,
  accessToken: string,
  profile: WebSessionProfileClaims | null,
  expiresAt: Date,
) {
  const sessionId = randomOpaqueValue()
  const sessionIdHash = await hashOpaqueValue(sessionId)
  const now = new Date().toISOString()
  const db = drizzle(c.env.DB)
  await db.delete(webAuthSessions).where(lte(webAuthSessions.expiresAt, now))
  await db.insert(webAuthSessions).values({
    idHash: sessionIdHash,
    subject,
    encryptedAccessToken: await encryptWebSessionValue(c.env, accessToken, `web-session:${sessionIdHash}`),
    encryptedProfileClaims: profile
      ? await encryptWebSessionValue(c.env, JSON.stringify(profile), `web-session-profile:${sessionIdHash}`)
      : null,
    expiresAt: expiresAt.toISOString(),
    createdAt: now,
  })
  setCookie(c, cookieName(c.req.url, SESSION_COOKIE), sessionId, cookieOptions(c.req.url, expiresAt))
}

export async function webSessionClaims<E extends HonoEnv>(c: WebContext<E>): Promise<UserInfoClaims | null> {
  const session = await readWebSession(c)
  if (!session) return null
  enforceSameOriginForUnsafeRequest(c.req.raw)
  try {
    const claims = await getAccessTokenClaims(c.env, session.accessToken, oidcAudience(c.env, c.req.url))
    if (claims.sub !== session.subject) throw new OidcError('Web session subject does not match its Realmroot token')
    if (!session.profile) return claims
    if (session.profile.sub !== claims.sub) throw new OidcError('Web session profile subject does not match its token')
    return { ...claims, ...displayProfileClaims(session.profile) }
  } catch (error) {
    await invalidateWebSession(c, session.idHash)
    throw error instanceof OidcError ? error : new OidcError('Browser session is invalid')
  }
}

export async function webSessionAccessToken<E extends HonoEnv>(c: WebContext<E>) {
  enforceSameOriginForUnsafeRequest(c.req.raw)
  return (await readWebSession(c))?.accessToken ?? null
}

async function readWebSession<E extends HonoEnv>(c: WebContext<E>) {
  const sessionId = getCookie(c, cookieName(c.req.url, SESSION_COOKIE))
  if (!sessionId) return null
  const db = drizzle(c.env.DB)
  const now = new Date().toISOString()
  const session = await db
    .select()
    .from(webAuthSessions)
    .where(and(eq(webAuthSessions.idHash, await hashOpaqueValue(sessionId)), gt(webAuthSessions.expiresAt, now)))
    .get()
  if (!session) {
    deleteSessionCookie(c)
    return null
  }
  try {
    return {
      idHash: session.idHash,
      subject: session.subject,
      accessToken: await decryptWebSessionValue(c.env, session.encryptedAccessToken, `web-session:${session.idHash}`),
      profile: session.encryptedProfileClaims
        ? await decryptProfileClaims(c.env, session.encryptedProfileClaims, session.idHash)
        : null,
    }
  } catch {
    await invalidateWebSession(c, session.idHash)
    throw new OidcError('Browser session is invalid')
  }
}

function profileClaims(claims: { sub?: unknown; email?: unknown; name?: unknown; picture?: unknown }) {
  if (typeof claims.sub !== 'string' || !claims.sub) return null
  return {
    sub: claims.sub,
    ...optionalStringClaim('email', claims.email),
    ...optionalStringClaim('name', claims.name),
    ...optionalStringClaim('picture', claims.picture),
  } satisfies WebSessionProfileClaims
}

async function decryptProfileClaims(env: Env, encryptedProfileClaims: string, sessionIdHash: string) {
  const value = JSON.parse(
    await decryptWebSessionValue(env, encryptedProfileClaims, `web-session-profile:${sessionIdHash}`),
  ) as unknown
  const profile = profileClaims(value as WebSessionProfileClaims)
  if (!profile) {
    throw new Error('Browser session profile is invalid')
  }
  return profile
}

function displayProfileClaims(profile: WebSessionProfileClaims) {
  return {
    ...optionalStringClaim('email', profile.email),
    ...optionalStringClaim('name', profile.name),
    ...optionalStringClaim('picture', profile.picture),
  }
}

function optionalStringClaim(key: 'email' | 'name' | 'picture', value: unknown) {
  return typeof value === 'string' ? { [key]: value } : {}
}

export async function deleteWebSession<E extends HonoEnv>(c: WebContext<E>) {
  enforceSameOriginForUnsafeRequest(c.req.raw)
  const sessionId = getCookie(c, cookieName(c.req.url, SESSION_COOKIE))
  if (sessionId) {
    await drizzle(c.env.DB)
      .delete(webAuthSessions)
      .where(eq(webAuthSessions.idHash, await hashOpaqueValue(sessionId)))
  }
  deleteSessionCookie(c)
}

export function requireWebOidcConfig(env: Env) {
  const { clientId } = requireOidcConfig(env)
  if (!env.OIDC_CLIENT_SECRET) throw new Error('OIDC_CLIENT_SECRET is required for browser sign-in')
  if (!env.WEB_SESSION_ENCRYPTION_KEY || env.WEB_SESSION_ENCRYPTION_KEY.length < 32) {
    throw new Error('WEB_SESSION_ENCRYPTION_KEY with at least 32 characters is required for browser sign-in')
  }
  return { clientId, clientSecret: env.OIDC_CLIENT_SECRET }
}

async function discover(env: Env): Promise<OidcMetadata> {
  requireWebOidcConfig(env)
  const { issuer } = requireOidcConfig(env)
  const cached = metadataCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) return cached.metadata
  const issuerUrl = new URL(issuer)
  const response = await oauth.discoveryRequest(issuerUrl, {
    algorithm: 'oidc',
    signal: AbortSignal.timeout(5000),
  })
  const metadata = await oauth.processDiscoveryResponse(issuerUrl, response)
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('Realmroot discovery omitted browser authorization endpoints')
  }
  const validated = metadata as OidcMetadata
  metadataCache.set(issuer, { metadata: validated, expiresAt: Date.now() + OIDC_METADATA_TTL_MS })
  return validated
}

async function authorizationRateLimitKeys<E extends HonoEnv>(c: WebContext<E>) {
  let clientId = getCookie(c, cookieName(c.req.url, AUTH_CLIENT_COOKIE))
  if (!clientId || !/^[A-Za-z0-9_-]{43}$/.test(clientId)) {
    clientId = randomOpaqueValue()
    setCookie(
      c,
      cookieName(c.req.url, AUTH_CLIENT_COOKIE),
      clientId,
      cookieOptions(c.req.url, new Date(Date.now() + AUTH_CLIENT_TTL_MS)),
    )
  }
  const address = c.req.header('cf-connecting-ip') ?? 'non-cloudflare-client'
  return {
    clientKey: await hashOpaqueValue(clientId),
    addressKey: await hashWebSessionClientAddress(c.env, address),
  }
}

function browserScopes(env: Env) {
  return (env.OIDC_BROWSER_SCOPES ?? 'openid profile email').split(/\s+/).filter(Boolean).join(' ')
}

function callbackUri(requestUrl: string) {
  return `${new URL(requestUrl).origin}/api/v1/auth/authorization-responses`
}

function safeReturnTo(value: string, requestUrl: string) {
  if ([...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return '/'
  try {
    const requestOrigin = new URL(requestUrl).origin
    const target = new URL(value, requestOrigin)
    return target.origin === requestOrigin ? `${target.pathname}${target.search}${target.hash}` : '/'
  } catch {
    return '/'
  }
}

function enforceSameOriginForUnsafeRequest(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) throw new WebSessionCsrfError()
}

function cookieOptions(requestUrl: string, expires: Date) {
  return {
    path: '/',
    httpOnly: true,
    secure: new URL(requestUrl).protocol === 'https:',
    sameSite: 'Lax' as const,
    expires,
  }
}

function deleteSessionCookie<E extends HonoEnv>(c: WebContext<E>) {
  deleteCookie(c, cookieName(c.req.url, SESSION_COOKIE), cookieDeletionOptions(c.req.url))
}

async function invalidateWebSession<E extends HonoEnv>(c: WebContext<E>, idHash: string) {
  await drizzle(c.env.DB).delete(webAuthSessions).where(eq(webAuthSessions.idHash, idHash))
  deleteSessionCookie(c)
}

function cookieName(requestUrl: string, name: string) {
  return new URL(requestUrl).protocol === 'https:' ? `__Host-${name}` : name
}

function cookieDeletionOptions(requestUrl: string) {
  return { path: '/', secure: new URL(requestUrl).protocol === 'https:' }
}
