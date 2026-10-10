// Local AI endpoint for the dev server: POST /api/chat.
//
// The browser owns the conversation and runs the tools (they reuse the app's
// scoring code, so answers match the table). This endpoint only holds the API
// key and forwards one turn at a time to Claude. The key comes from
// web/.env.local (gitignored) or the environment and never reaches the browser.

import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { SYSTEM_PROMPT } from './systemPrompt.ts'
import { TOOLS } from './tools.ts'

const MODEL = 'claude-opus-5-5'

export function chatPlugin(): Plugin {
  let client: Anthropic | null = null
  let keyMissing = false

  return {
    name: 'hunt-ranker-chat',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir ?? process.cwd(), 'ANTHROPIC_')
      const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
      if (apiKey) client = new Anthropic({ apiKey })
      else keyMissing = true

      server.middlewares.use('/api/chat', (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
        if (!client) {
          return send(res, 503, {
            error: keyMissing
              ? 'No API key. Add ANTHROPIC_API_KEY=... to web/.env.local, then restart `npm run dev`.'
              : 'AI client not initialised.',
          })
        }
        handle(client, req, res).catch((err) => send(res, 500, { error: String(err) }))
      })
    },
  }
}

async function handle(client: Anthropic, req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req)) as { messages?: Anthropic.Beta.BetaMessageParam[] }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return send(res, 400, { error: 'messages[] required' })
  }
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: body.messages,
      // Opus 5.5 always thinks; effort sets how much. Medium suits lookup-style questions.
      output_config: { effort: 'medium' },
      // Caches the stable prefix (tools + system + earlier turns) across the tool loop.
      cache_control: { type: 'ephemeral' },
      // If a safety classifier declines, re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    send(res, 200, {
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_details ?? null,
      model: response.model,
      usage: response.usage,
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return send(res, 401, { error: 'API key rejected. Check ANTHROPIC_API_KEY in web/.env.local.' })
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Rate limited by the API. Wait a moment and try again.' })
    if (err instanceof Anthropic.BadRequestError) return send(res, 400, { error: `Bad request: ${err.message}` })
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `API error ${err.status}: ${err.message}` })
    throw err
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}
