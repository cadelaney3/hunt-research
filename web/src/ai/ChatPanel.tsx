import type Anthropic from '@anthropic-ai/sdk'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { runTool, type ToolContext } from './tools'

type Msg = Anthropic.Beta.BetaMessageParam
type Block = Anthropic.Beta.BetaContentBlock
type Usage = Anthropic.Beta.BetaUsage

interface ChatResponse {
  content: Block[]
  stop_reason: string | null
  stop_details: { category?: string | null; explanation?: string | null } | null
  model: string
  usage: Usage
  error?: string
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'activity'; text: string }
  | { kind: 'error'; text: string }

const MAX_STEPS = 15
// Claude Opus 5.5 list prices per token, for a rough running cost. Approximate:
// a refusal fallback may bill at another model's rates.
const PRICE = { input: 4e-6, output: 20e-6, cacheWrite: 5e-6, cacheRead: 0.2e-6 }

const EXAMPLES = [
  'Which elk permits can I realistically draw in the next few years that have lots of mature bulls?',
  'Compare the general elk hunt in 215 with the 217 Elk B tags.',
  'Show me draw elk hunts with over 50% public land, sorted by success.',
]

interface Props {
  ctx: ToolContext
  onOpenHunt: (id: string) => void
  onClose: () => void
}

export default function ChatPanel({ ctx, onOpenHunt, onClose }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cost, setCost] = useState(0)
  const history = useRef<Msg[]>([])
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [items, busy])

  const add = (item: Item) => setItems((xs) => [...xs, item])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    add({ kind: 'user', text: q })

    const s = ctxRef.current.settings
    // Per-turn context goes in the user turn (the system prompt stays fixed and cached).
    history.current.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[Table settings: ${s.residency === 'R' ? 'resident' : 'nonresident'}, ${s.points} points, ` +
            `last ${s.years} years averaged, showing ${ctxRef.current.currentSpecies}.]`,
        },
        { type: 'text', text: q },
      ],
    })

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.current }),
        })
        const data = (await res.json()) as ChatResponse
        if (!res.ok || data.error) {
          add({ kind: 'error', text: data.error ?? `Request failed (${res.status})` })
          // Drop the unanswered user turn so the next question starts clean.
          if (history.current.at(-1)?.role === 'user' && step === 0) history.current.pop()
          return
        }
        setCost((c) => c + turnCost(data.usage))

        // Keep the assistant turn exactly as returned (thinking blocks included).
        history.current.push({ role: 'assistant', content: data.content as Msg['content'] })
        const text = data.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
        if (text) add({ kind: 'assistant', text })

        if (data.stop_reason === 'refusal') {
          add({ kind: 'error', text: `The model declined to answer${data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.'}` })
          return
        }
        if (data.stop_reason === 'max_tokens') {
          add({ kind: 'error', text: 'The answer hit the length limit and was cut off.' })
          return
        }
        if (data.stop_reason === 'pause_turn') continue

        const calls = data.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (!calls.length) return

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
          const out = runTool(call.name, call.input, ctxRef.current)
          add({ kind: 'activity', text: out.activity })
          return { type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) }
        })
        // All results for one assistant turn go back in a single user message.
        history.current.push({ role: 'user', content: results })
      }
      add({ kind: 'error', text: `Stopped after ${MAX_STEPS} steps without a final answer.` })
    } catch (e) {
      add({ kind: 'error', text: `Couldn't reach the local AI endpoint: ${String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    history.current = []
    setItems([])
    setCost(0)
  }

  return (
    <aside className="chat" aria-label="Ask the data">
      <header className="chat-head">
        <div>
          <strong>Ask the data</strong>
          <div className="muted small">
            Uses your table settings · {cost > 0 ? `≈ $${cost.toFixed(cost < 0.1 ? 3 : 2)} this chat` : 'Claude Opus 5.5'}
          </div>
        </div>
        <div className="chat-actions">
          {items.length > 0 && <button className="link" onClick={reset} disabled={busy}>New chat</button>}
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </header>

      <div className="chat-body" ref={scroller}>
        {items.length === 0 && (
          <div className="chat-empty">
            <p className="muted small">Ask about draw odds, harvest, herds or land. Answers come from the loaded data, using your residency and points.</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chat-example" onClick={() => ask(ex)}>{ex}</button>
            ))}
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className={`chat-item ${it.kind}`}>
            {it.kind === 'assistant' ? <RichText text={it.text} onOpenHunt={onOpenHunt} /> : it.text}
          </div>
        ))}
        {busy && <div className="chat-item activity pulse">Thinking…</div>}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <textarea
          value={input}
          placeholder="e.g. Best elk permit I can draw with 6 points?"
          rows={2}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
          }}
        />
        <button type="submit" className="chat-send" disabled={busy || !input.trim()}>Ask</button>
      </form>
    </aside>
  )
}

function turnCost(u: Usage | undefined) {
  if (!u) return 0
  return (u.input_tokens ?? 0) * PRICE.input + (u.output_tokens ?? 0) * PRICE.output +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead
}

/** Paragraphs, "- " bullets, **bold**, and [[hunt_id|label]] links. Everything else is plain text. */
function RichText({ text, onOpenHunt }: { text: string; onOpenHunt: (id: string) => void }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l, onOpenHunt)}</li>)}</ul>)
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    if (bullet) { list.push(bullet[1]); continue }
    flush()
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''), onOpenHunt)}</p>)
  }
  flush()
  return <>{blocks}</>
}

function inline(s: string, onOpenHunt: (id: string) => void): ReactNode {
  const parts = s.split(/(\[\[[^\]|]+\|[^\]]+\]\]|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    const link = p.match(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/)
    if (link) return <button key={i} className="hunt-link" onClick={() => onOpenHunt(link[1])}>{link[2]}</button>
    const bold = p.match(/^\*\*([^*]+)\*\*$/)
    if (bold) return <strong key={i}>{bold[1]}</strong>
    return <Fragment key={i}>{p}</Fragment>
  })
}
