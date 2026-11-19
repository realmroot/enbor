import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUsageRepo } from '../adapters/repos/usage-records'
import { projects, usageRecords } from '../db/schema'
import { dpopHeaders, setupOidcProvider, signIn } from './auth'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...init.headers,
    },
  })
}

async function projectContext(authorization: string) {
  const res = await jsonFetch('/api/v1/projects', authorization)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: Array<{ id: string }> }
  const projectId = body.data[0]?.id
  if (!projectId) throw new Error('expected a default project')
  const row = await drizzle(env.DB).select().from(projects).where(eq(projects.id, projectId)).get()
  if (!row) throw new Error('expected the project row')
  return { id: row.id, organizationId: row.organizationId }
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function usageRow(project: { id: string; organizationId: string }, values: Partial<typeof usageRecords.$inferInsert>) {
  return {
    id: newId('usage'),
    organizationId: project.organizationId,
    projectId: project.id,
    agentId: 'agent_alpha',
    agentVersionId: 'agentver_alpha',
    sessionId: 'session_alpha',
    sessionEventId: newId('event'),
    correlationId: newId('corr'),
    providerId: 'workers-ai',
    providerType: 'workers-ai',
    modelId: '@cf/model-a',
    state: 'success',
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    durationMs: 100,
    costMicros: 25,
    currency: 'USD',
    usageType: 'model',
    metadata: '{}',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...values,
  }
}

describe('[CF] v1 usage records', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists usage records with provider, session, and time-range filters [spec: usage/records-api]', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const db = drizzle(env.DB)
    await db.insert(usageRecords).values([
      usageRow(project, {}),
      usageRow(project, { sessionId: 'session_beta', createdAt: '2026-05-02T00:00:00.000Z' }),
      usageRow(project, {
        providerId: null,
        providerType: 'sandbox',
        modelId: 'bash',
        usageType: 'tool',
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
    ])

    const listRes = await jsonFetch('/api/v1/usage-records', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<Record<string, unknown>> }
    expect(list.data).toHaveLength(3)
    expect(JSON.stringify(list)).not.toContain('organizationId')

    const providerRes = await jsonFetch('/api/v1/usage-records?providerId=workers-ai', authorization)
    const providerList = (await providerRes.json()) as { data: Array<{ providerId: string }> }
    expect(providerList.data).toHaveLength(2)

    const sessionRes = await jsonFetch('/api/v1/usage-records?sessionId=session_beta', authorization)
    const sessionList = (await sessionRes.json()) as { data: Array<{ sessionId: string }> }
    expect(sessionList.data).toEqual([expect.objectContaining({ sessionId: 'session_beta' })])

    const rangeRes = await jsonFetch(
      '/api/v1/usage-records?from=2026-05-02T00%3A00%3A00.000Z&to=2026-05-02T23%3A59%3A59.999Z',
      authorization,
    )
    const rangeList = (await rangeRes.json()) as { data: Array<{ sessionId: string }> }
    expect(rangeList.data).toEqual([expect.objectContaining({ sessionId: 'session_beta' })])
  })

  it('reads a single usage record and 404s unknown ids [spec: usage/records-api]', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const seeded = usageRow(project, {})
    await drizzle(env.DB).insert(usageRecords).values([seeded])

    const readRes = await jsonFetch(`/api/v1/usage-records/${seeded.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: seeded.id,
      providerId: 'workers-ai',
      modelId: '@cf/model-a',
      totalTokens: 15,
    })

    const missingRes = await jsonFetch('/api/v1/usage-records/usage_does_not_exist', authorization)
    expect(missingRes.status).toBe(404)
  })

  it('exports filtered usage records as CSV via Accept: text/csv [spec: usage/export-api]', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const db = drizzle(env.DB)
    await db
      .insert(usageRecords)
      .values([
        usageRow(project, {}),
        usageRow(project, { providerId: null, providerType: 'sandbox', modelId: 'bash', usageType: 'tool' }),
      ])

    const res = await jsonFetch('/api/v1/usage-records?providerId=workers-ai', authorization, {
      headers: { accept: 'text/csv' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('usage-records.csv')
    const lines = (await res.text()).trimEnd().split('\n')
    expect(lines[0]).toBe(
      'id,createdAt,projectId,agentId,agentVersionId,sessionId,providerId,providerType,modelId,state,usageType,promptTokens,completionTokens,totalTokens,durationMs,costMicros,currency',
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('workers-ai')
    expect(lines[1]).toContain('15,100,25,USD')
  })
})

describe('[CF] platform budget usage sum', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('[spec: governance/platform-daily-budget] sums successful spend since a day start, per platform and organization', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const db = drizzle(env.DB)
    const day = '2031-01-02'
    for (const row of [
      usageRow(project, { costMicros: 100, createdAt: `${day}T00:00:00.000Z` }),
      usageRow(project, { costMicros: 50, createdAt: `${day}T23:59:59.999Z` }),
      usageRow(project, { costMicros: 7, state: 'error', createdAt: `${day}T01:00:00.000Z` }),
      usageRow(project, { costMicros: 9, createdAt: '2031-01-01T23:59:59.999Z' }),
      usageRow(project, { costMicros: 1000, organizationId: 'org_other', createdAt: `${day}T02:00:00.000Z` }),
    ]) {
      await db.insert(usageRecords).values(row)
    }
    const repo = createUsageRepo(db)

    expect(await repo.costMicrosSince(`${day}T00:00:00.000Z`)).toBe(1150)
    expect(await repo.costMicrosSince(`${day}T00:00:00.000Z`, project.organizationId)).toBe(150)
    expect(await repo.costMicrosSince('2031-01-03T00:00:00.000Z', project.organizationId)).toBe(0)
  })
})
