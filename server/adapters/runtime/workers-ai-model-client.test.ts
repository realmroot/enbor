import type { Context, Model } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'
import { ProviderCallError, RuntimeTurnCancelledError } from '../../usecases/runtime/engine/errors'
import { workersAiModelClient } from './workers-ai-model-client'

// Minimal valid model object — workers-ai provider.
const model: Model<string> = {
  id: '@cf/moonshotai/kimi-k2.7-code',
  name: 'kimi-k2.7-code',
  api: 'openai-completions',
  provider: 'workers-ai',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 8192,
}

// Helper factories produce correctly-typed Message objects without verbose repetition.
function userMsg(content: string) {
  return { role: 'user' as const, content, timestamp: 0 }
}
function toolResultMsg(toolCallId: string, toolName: string, content: string) {
  return {
    role: 'toolResult' as const,
    toolCallId,
    toolName,
    content: [{ type: 'text' as const, text: content }],
    isError: false,
    timestamp: 0,
  }
}
function assistantTextMsg(content: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: content }],
    api: 'openai-completions' as const,
    provider: 'workers-ai',
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: 0,
  }
}

// Minimal valid context.
const context: Context = {
  messages: [userMsg('hi')],
}

// A minimal OpenAI-shaped response that `providerAssistantMessage` can parse.
function successResponse(text = 'ok') {
  return {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

// An opaque error — no status, no code — so it normalizes to category 'unknown',
// which is retryable by `isRetryableProviderError`.
function opaqueError(msg = 'upstream capacity unavailable') {
  return new Error(msg)
}

// An auth error: status 401, code 'invalid_api_key' → category 'auth' → not retryable.
function authError() {
  return Object.assign(new Error('401 invalid api key'), { status: 401, code: 'invalid_api_key' })
}

function makeEnv(aiRun: ReturnType<typeof vi.fn>): Env {
  return {
    RUNTIME_MODE: 'live',
    AI: { run: aiRun },
  } as unknown as Env
}

function testEnv(): Env {
  return { RUNTIME_MODE: 'test', AI: { run: vi.fn() } } as unknown as Env
}

function ctx(...prompts: string[]): Context {
  return { messages: prompts.map(userMsg) }
}

describe('workersAiModelClient — retry logic (live mode)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the mapped assistant message when AI.run succeeds on the first attempt', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse('hello'))
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.role).toBe('assistant')
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(aiRun).toHaveBeenCalledTimes(1)
  })

  it('calls AI.run with the model id, serialized messages, and tools', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))

    await client.complete(model, context)

    expect(aiRun).toHaveBeenCalledWith(
      model.id,
      expect.objectContaining({
        model: model.id,
        messages: expect.arrayContaining([{ role: 'user', content: 'hi' }]),
      }),
      // Every model routes through the default gateway; no signal is passed.
      { gateway: { id: 'enbor' } },
    )
  })

  it('retries after a transient (opaque) error and resolves on the third attempt', async () => {
    const aiRun = vi
      .fn()
      .mockRejectedValueOnce(opaqueError())
      .mockRejectedValueOnce(opaqueError())
      .mockResolvedValue(successResponse('recovered'))

    const client = workersAiModelClient(makeEnv(aiRun))

    // Run the promise concurrently with timer advances so backoff sleeps resolve.
    const [result] = await Promise.all([client.complete(model, context), vi.runAllTimersAsync()])

    expect(result.content).toEqual([{ type: 'text', text: 'recovered' }])
    expect(aiRun).toHaveBeenCalledTimes(3)
  })

  it('rejects with ProviderCallError after exhausting all 3 attempts with retryable errors', async () => {
    const aiRun = vi.fn().mockRejectedValue(opaqueError('capacity error'))
    const client = workersAiModelClient(makeEnv(aiRun))

    const [, error] = await Promise.allSettled([vi.runAllTimersAsync(), client.complete(model, context)])

    expect(error.status).toBe('rejected')
    expect((error as PromiseRejectedResult).reason).toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledTimes(3)
  })

  it('rejects immediately with ProviderCallError on a non-retryable (auth) error', async () => {
    const aiRun = vi.fn().mockRejectedValue(authError())
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledTimes(1)
  })

  it('does not retry when AI.run throws a ProviderCallError with a non-retryable category', async () => {
    // Wrap an auth error as a ProviderCallError directly.
    const preNormalized = new ProviderCallError({
      category: 'auth',
      message: 'credential rejected',
      retryable: false,
    })
    const aiRun = vi.fn().mockRejectedValue(preNormalized)
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledTimes(1)
  })

  it('rethrows RuntimeTurnCancelledError without retrying when AI.run throws it', async () => {
    const aiRun = vi.fn().mockRejectedValue(new RuntimeTurnCancelledError())
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(RuntimeTurnCancelledError)
    expect(aiRun).toHaveBeenCalledTimes(1)
  })

  it('throws RuntimeTurnCancelledError and never calls AI.run when signal is already aborted', async () => {
    const aiRun = vi.fn()
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context, AbortSignal.abort())).rejects.toBeInstanceOf(RuntimeTurnCancelledError)
    expect(aiRun).not.toHaveBeenCalled()
  })

  it('passes the AbortSignal to AI.run when one is provided and not yet aborted', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const controller = new AbortController()
    const client = workersAiModelClient(makeEnv(aiRun))

    await client.complete(model, context, controller.signal)

    expect(aiRun).toHaveBeenCalledWith(model.id, expect.anything(), {
      gateway: { id: 'enbor' },
      signal: controller.signal,
    })
  })

  it('exposes the normalized error category in the ProviderCallError after exhaustion', async () => {
    const aiRun = vi.fn().mockRejectedValue(opaqueError())
    const client = workersAiModelClient(makeEnv(aiRun))

    const [, result] = await Promise.allSettled([vi.runAllTimersAsync(), client.complete(model, context)])

    expect(result.status).toBe('rejected')
    const error = (result as PromiseRejectedResult).reason
    expect(error).toBeInstanceOf(ProviderCallError)
    expect((error as ProviderCallError).normalized.category).toBe('unknown')
  })

  it('maps a rate-limit error (429) as retryable and retries up to 3 times', async () => {
    const rateLimitError = Object.assign(new Error('429 too many requests'), {
      status: 429,
      code: 'rate_limit_exceeded',
    })
    const aiRun = vi.fn().mockRejectedValue(rateLimitError)
    const client = workersAiModelClient(makeEnv(aiRun))

    const [, result] = await Promise.allSettled([vi.runAllTimersAsync(), client.complete(model, context)])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledTimes(3)
  })
})

describe('workersAiModelClient — message serialization (openAiMessages + openAiTools)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prepends a system message when context has systemPrompt', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    const withSystem: Context = {
      systemPrompt: 'You are helpful.',
      messages: [userMsg('hello')],
    }

    await client.complete(model, withSystem)

    expect(aiRun).toHaveBeenCalledWith(
      model.id,
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'system', content: 'You are helpful.' }]),
      }),
      { gateway: { id: 'enbor' } },
    )
  })

  it('serializes an assistant message with string content', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    // AssistantMessage.content must be an array — use a text block, not bare string.
    const withHistory: Context = {
      messages: [assistantTextMsg('previous answer'), userMsg('follow up')],
    }

    await client.complete(model, withHistory)

    expect(aiRun).toHaveBeenCalledWith(
      model.id,
      expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]),
      }),
      { gateway: { id: 'enbor' } },
    )
  })

  it('serializes an assistant message with array content (text blocks + tool_calls)', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    const withToolCall: Context = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'thinking...' },
            { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
          ],
          api: 'openai-completions',
          provider: 'workers-ai',
          model: model.id,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 0,
        },
        userMsg('continue'),
      ],
    }

    await client.complete(model, withToolCall)

    const callArgs = aiRun.mock.calls[0] as [string, { messages: Array<Record<string, unknown>> }]
    const messages = callArgs[1].messages
    const assistantEntry = messages.find((m) => m.role === 'assistant')
    expect(assistantEntry).toBeDefined()
    const toolCalls = (assistantEntry as Record<string, unknown>).tool_calls
    expect(toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
      },
    ])
  })

  it('serializes a tool-result message (role: toolResult) to an OpenAI tool message', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    const withToolResult: Context = {
      messages: [toolResultMsg('call_1', 'bash', 'stdout: ok'), userMsg('done')],
    }

    await client.complete(model, withToolResult)

    const callArgs = aiRun.mock.calls[0] as [string, { messages: Array<Record<string, unknown>> }]
    const toolMsg = callArgs[1].messages.find((m) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'stdout: ok' })
  })

  it('serializes a tool-result message whose content is an array of text blocks', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    const withArrayContent: Context = {
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_2',
          toolName: 'read',
          content: [{ type: 'text', text: 'file content here' }],
          isError: false,
          timestamp: 0,
        },
        userMsg('ok'),
      ],
    }

    await client.complete(model, withArrayContent)

    const callArgs = aiRun.mock.calls[0] as [string, { messages: Array<Record<string, unknown>> }]
    const toolMsg = callArgs[1].messages.find((m) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ content: 'file content here' })
  })

  it('serializes tools from context into the OpenAI tools array', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const client = workersAiModelClient(makeEnv(aiRun))
    const withTools: Context = {
      messages: [userMsg('run something')],
      tools: [
        {
          name: 'bash',
          description: 'Run a shell command',
          parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        },
      ],
    }

    await client.complete(model, withTools)

    expect(aiRun).toHaveBeenCalledWith(
      model.id,
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'bash',
              description: 'Run a shell command',
              parameters: expect.objectContaining({ type: 'object' }),
            },
          },
        ],
      }),
      { gateway: { id: 'enbor' } },
    )
  })
})

describe('workersAiModelClient — response mapping (providerAssistantMessage)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps tool_calls from the provider response to toolCall content blocks', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', id: 'call_abc', name: 'bash' })
    expect(result.stopReason).toBe('toolUse')
    expect(result.content).toHaveLength(1)
    expect(aiRun).toHaveBeenCalledOnce()
  })

  it('falls back to record.response when choices is absent', async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: 'fallback text' })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.content).toEqual([{ type: 'text', text: 'fallback text' }])
  })

  it('falls back to record.text when choices and response are absent', async () => {
    const aiRun = vi.fn().mockResolvedValue({ text: 'text field' })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.content).toEqual([{ type: 'text', text: 'text field' }])
  })

  it('rejects an empty completion instead of reporting successful final output [spec: runtime/turn]', async () => {
    const aiRun = vi.fn().mockResolvedValue({ choices: [{ message: { role: 'assistant', content: '' } }] })
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledOnce()
  })

  it.each([
    { label: 'whitespace-only', message: { content: ' \n\t ' } },
    { label: 'reasoning-only', message: { content: null, reasoning_content: 'PRIVATE_REASONING_SENTINEL' } },
    { label: 'kimi-reasoning-only', message: { content: null, reasoning: 'PRIVATE_REASONING_SENTINEL' } },
    {
      label: 'reasoning-block-only',
      message: { content: [{ type: 'reasoning', text: 'PRIVATE_REASONING_SENTINEL' }] },
    },
  ])('rejects $label output without retries or leaking provider content [spec: runtime/turn]', async ({ message }) => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
      usage: { completion_tokens: 324 },
      debug: 'PRIVATE_PROVIDER_PAYLOAD',
    })
    const client = workersAiModelClient(makeEnv(aiRun))
    const error = await client.complete(model, context).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(ProviderCallError)
    expect(error).toMatchObject({ normalized: { retryable: false } })
    const exposed = `${String(error)} ${JSON.stringify(error)}`
    expect(exposed).not.toContain('PRIVATE_REASONING_SENTINEL')
    expect(exposed).not.toContain('PRIVATE_PROVIDER_PAYLOAD')
    expect(aiRun).toHaveBeenCalledOnce()
  })

  it('extracts usage from the provider response', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'done' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.usage.input).toBe(20)
    expect(result.usage.output).toBe(10)
    expect(result.usage.totalTokens).toBe(30)
  })

  it('produces ZERO_USAGE when the provider returns no usage object', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'done' } }],
    })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.usage.input).toBe(0)
    expect(result.usage.output).toBe(0)
    expect(result.usage.totalTokens).toBe(0)
  })

  it('parses tool_call arguments given as a plain object (not a string)', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_obj',
                type: 'function',
                function: { name: 'bash', arguments: { command: 'pwd' } },
              },
            ],
          },
        },
      ],
    })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    const toolCall = result.content.find((b) => b.type === 'toolCall')
    expect(toolCall).toMatchObject({ type: 'toolCall', name: 'bash' })
    expect((toolCall as { arguments: Record<string, unknown> }).arguments).toEqual({ command: 'pwd' })
  })

  it('skips malformed tool_call entries without a name', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'text',
            tool_calls: [{ id: 'call_bad', type: 'function', function: { arguments: '{}' } }],
          },
        },
      ],
    })
    const client = workersAiModelClient(makeEnv(aiRun))

    const result = await client.complete(model, context)

    expect(result.content.filter((b) => b.type === 'toolCall')).toHaveLength(0)
    expect(result.stopReason).toBe('stop')
  })

  it('rejects a null provider response instead of fabricating an empty final answer [spec: runtime/turn]', async () => {
    const aiRun = vi.fn().mockResolvedValue(null)
    const client = workersAiModelClient(makeEnv(aiRun))

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledOnce()
  })
})

describe('workersAiModelClient — tool_call edge cases', () => {
  it('handles a null tool_call entry by skipping it (no content block emitted)', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'text', tool_calls: [null] } }],
    })
    const env = { RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env
    const client = workersAiModelClient(env)

    const result = await client.complete(model, context)

    expect(result.content.filter((b) => b.type === 'toolCall')).toHaveLength(0)
  })

  it('falls back to call.name when call.function is absent', async () => {
    // call.function is falsy — falls back to call.name for the tool name
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_y', name: 'bash', arguments: { command: 'pwd' } }],
          },
        },
      ],
    })
    const env = { RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env
    const client = workersAiModelClient(env)

    const result = await client.complete(model, context)

    const toolCall = result.content.find((b) => b.type === 'toolCall')
    expect(toolCall).toMatchObject({ name: 'bash' })
  })

  it('rejects a completion whose only tool call lacks a stable id [spec: runtime/turn]', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ type: 'function', function: { name: 'bash', arguments: '{}' } }],
          },
        },
      ],
    })
    const env = { RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env
    const client = workersAiModelClient(env)

    await expect(client.complete(model, context)).rejects.toBeInstanceOf(ProviderCallError)
    expect(aiRun).toHaveBeenCalledOnce()
  })

  it('returns empty object when tool_call function.arguments is null', async () => {
    const aiRun = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'bash', arguments: null } }],
          },
        },
      ],
    })
    const env = { RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env
    const client = workersAiModelClient(env)

    const result = await client.complete(model, context)

    const toolCall = result.content.find((b) => b.type === 'toolCall')
    expect((toolCall as { arguments: Record<string, unknown> }).arguments).toEqual({})
  })
})

describe('workersAiModelClient — textContent edge cases', () => {
  it('returns empty string for tool-result content that is neither string nor array', async () => {
    // Passes null as content → textContent(null) → !Array.isArray → '' → falls back to 'ok'
    const client = workersAiModelClient(testEnv())
    const withNull: Context = {
      messages: [
        userMsg('inspect'),
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'bash',
          content: null as unknown as [],
          isError: false,
          timestamp: 0,
        },
      ],
    }

    const result = await client.complete(model, withNull)

    const text = result.content.find((b) => b.type === 'text')
    expect((text as { type: 'text'; text: string }).text).toContain('ok')
  })

  it('returns empty string for array items lacking the text type', async () => {
    // content array with non-text-block items → textContent returns '' per item → joined → '' → 'ok'
    const client = workersAiModelClient(testEnv())
    const withImageContent: Context = {
      messages: [
        userMsg('inspect'),
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'bash',
          content: [{ type: 'image', data: 'abc' }] as unknown as [],
          isError: false,
          timestamp: 0,
        },
      ],
    }

    const result = await client.complete(model, withImageContent)

    const text = result.content.find((b) => b.type === 'text')
    expect((text as { type: 'text'; text: string }).text).toContain('ok')
  })
})

describe('workersAiModelClient — test mode bypass', () => {
  it('returns a deterministic assistant message without calling AI.run', async () => {
    const aiRun = vi.fn()
    const env = { RUNTIME_MODE: 'test', AI: { run: aiRun } } as unknown as Env
    const client = workersAiModelClient(env)

    const result = await client.complete(model, context)

    expect(result.role).toBe('assistant')
    expect(aiRun).not.toHaveBeenCalled()
  })

  it('includes the prompt text in the test-mode response content', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('What is 2+2?'))

    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toContain('What is 2+2?')
  })

  it('throws ProviderCallError in test mode when the prompt triggers a simulated provider failure', async () => {
    const client = workersAiModelClient(testEnv())

    await expect(client.complete(model, ctx('simulate provider auth error'))).rejects.toBeInstanceOf(ProviderCallError)
  })

  it('returns a tool-call message in test mode for a "write the file" prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('write the file /foo.txt with content hello world'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', name: 'write' })
    expect(result.stopReason).toBe('toolUse')
  })

  it('returns a tool-call message in test mode for a "read the file" prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('read the file /etc/config'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', name: 'read' })
  })

  it('returns a fetch tool-call in test mode for a fetch/outbound URL prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('fetch https://example.com/data'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', name: 'fetch' })
  })

  it('returns a web_search tool-call in test mode for a search prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('search managed agents architecture'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls[0]).toMatchObject({
      type: 'toolCall',
      name: 'web_search',
      arguments: { query: 'managed agents architecture' },
    })
  })

  it('returns an exec tool-call in test mode for a "run the sandbox command" prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('run the sandbox command "echo hello"'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', name: 'bash', arguments: { command: 'echo hello' } })
  })

  it('returns a git-status tool-call in test mode for an inspect/status prompt', async () => {
    const client = workersAiModelClient(testEnv())

    const result = await client.complete(model, ctx('inspect repository status'))

    const toolCalls = result.content.filter((b) => b.type === 'toolCall')
    expect(toolCalls[0]).toMatchObject({ type: 'toolCall', name: 'bash', arguments: { command: 'git status' } })
  })

  it('echoes tool result text in test mode when the last message is a toolResult', async () => {
    const client = workersAiModelClient(testEnv())
    const withResult: Context = {
      messages: [userMsg('inspect'), toolResultMsg('c1', 'bash', 'branch main')],
    }

    const result = await client.complete(model, withResult)

    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toContain('Tool result observed: branch main')
  })

  it('returns "ok" when the last toolResult message has empty content', async () => {
    const client = workersAiModelClient(testEnv())
    const withEmptyResult: Context = {
      messages: [userMsg('inspect'), toolResultMsg('c1', 'bash', '')],
    }

    const result = await client.complete(model, withEmptyResult)

    const text = result.content.find((b) => b.type === 'text')
    expect((text as { type: 'text'; text: string }).text).toContain('ok')
  })

  it('echoes the previous prompt in test mode for a "previous prompt" query', async () => {
    const client = workersAiModelClient(testEnv())
    const withHistory: Context = {
      messages: [userMsg('First question here'), assistantTextMsg('Answer'), userMsg('what was my previous prompt?')],
    }

    const result = await client.complete(model, withHistory)

    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toContain('First question here')
  })

  it('rethrows ProviderCallError that was thrown directly in test mode (catch re-throw path)', async () => {
    // The test-mode catch block rethrows ProviderCallError without re-wrapping.
    const client = workersAiModelClient(testEnv())
    const err = await client.complete(model, ctx('simulate provider quota error')).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ProviderCallError)
    expect((err as ProviderCallError).normalized.category).toBe('quota')
  })

  it('simulates all supported provider error categories in test mode', async () => {
    const categories: Array<[string, string]> = [
      ['simulate provider rate limit error', 'rate_limit'],
      ['simulate provider model unavailable error', 'model_unavailable'],
      ['simulate provider invalid request error', 'invalid_request'],
      ['simulate provider network error', 'network'],
      ['simulate provider unknown error', 'unknown'],
    ]
    const client = workersAiModelClient(testEnv())

    for (const [prompt, expectedCategory] of categories) {
      const err = await client.complete(model, ctx(prompt)).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderCallError)
      expect((err as ProviderCallError).normalized.category).toBe(expectedCategory)
    }
  })

  it('resolves the "wait for cancellation" prompt after the internal delay', async () => {
    vi.useFakeTimers()
    try {
      const client = workersAiModelClient(testEnv())

      const [result] = await Promise.all([
        client.complete(model, ctx('wait for cancellation then reply')),
        vi.runAllTimersAsync(),
      ])

      expect(result.role).toBe('assistant')
    } finally {
      vi.useRealTimers()
    }
  })

  it('wraps plain thrown errors in test mode in ProviderCallError', async () => {
    // Errors that are neither RuntimeTurnCancelledError nor ProviderCallError are wrapped.
    const client = workersAiModelClient(testEnv())
    // network error → TypeError → normalizes to 'network' category
    const err = await client.complete(model, ctx('simulate provider network error')).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ProviderCallError)
    expect((err as ProviderCallError).normalized.category).toBe('network')
  })

  it('uses empty prompt string when there is no user message in the context', async () => {
    const client = workersAiModelClient(testEnv())
    // Context with only an assistant message — no user message → prompt is '' → default echo
    const assistantOnlyCtx: Context = {
      messages: [assistantTextMsg('I said something')],
    }

    const result = await client.complete(model, assistantOnlyCtx)

    expect(result.role).toBe('assistant')
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toContain('Enbor runtime processed:')
  })

  it('returns "none" when there is no previous user prompt in the history', async () => {
    const client = workersAiModelClient(testEnv())
    // Only one user message — previousUser at(1) will be undefined → 'none'
    const result = await client.complete(model, ctx('what was my previous prompt?'))

    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toContain('none')
  })
})

describe('[spec: providers/ai-gateway-routing] workersAiModelClient — AI gateway routing (live mode)', () => {
  const thirdPartyModel: Model<string> = { ...model, id: 'anthropic/claude-sonnet-4' }

  it('routes a third-party model through the default "enbor" gateway', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    await workersAiModelClient(makeEnv(aiRun)).complete(thirdPartyModel, context)
    expect(aiRun).toHaveBeenCalledWith('anthropic/claude-sonnet-4', expect.anything(), { gateway: { id: 'enbor' } })
  })

  it('honors AI_GATEWAY_ID for third-party models', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    const env = { RUNTIME_MODE: 'live', AI: { run: aiRun }, AI_GATEWAY_ID: 'custom-gw' } as unknown as Env
    await workersAiModelClient(env).complete(thirdPartyModel, context)
    expect(aiRun).toHaveBeenCalledWith('anthropic/claude-sonnet-4', expect.anything(), { gateway: { id: 'custom-gw' } })
  })

  it('routes a Workers AI (@cf) model through the gateway too', async () => {
    const aiRun = vi.fn().mockResolvedValue(successResponse())
    await workersAiModelClient(makeEnv(aiRun)).complete(model, context)
    expect(aiRun).toHaveBeenCalledWith(model.id, expect.anything(), { gateway: { id: 'enbor' } })
  })
})
