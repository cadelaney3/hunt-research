import { useState } from 'react'

interface Props {
  title: string
  data: { x: number; y: number | null }[]
  format: (v: number) => string
  /** Lower values are better (e.g. points required); only affects the subtitle. */
  note?: string
  zeroBased?: boolean
  /** Label for x values (default: years) */
  xFormat?: (x: number) => string
  /** Highlighted x value (e.g. your point level) */
  markX?: number
  /** Full-width variant: wider coordinate space so text stays the same size. */
  wide?: boolean
}

const H = 120
const PAD = { top: 10, right: 12, bottom: 20, left: 40 }

const yearLabel = (x: number, many: boolean) => (many ? `'${String(x).slice(2)}` : String(x))

/** Single-series line (by year, or by points): 2px line, ringed markers, crosshair + tooltip on hover. */

export default function LineChart({ title, data, format, note, zeroBased = true, xFormat, markX, wide }: Props) {
  const W = wide ? 600 : 280
  const [hover, setHover] = useState<number | null>(null)
  const pts = data.filter((d): d is { x: number; y: number } => d.y != null)

  const header = (
    <div className="chart-head">
      <span className="chart-title">{title}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  )
  if (!pts.length) return <figure className="chart">{header}<div className="chart-empty muted small">No data</div></figure>

  const xs = data.map((d) => d.x)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  let y0 = zeroBased ? 0 : Math.min(...pts.map((p) => p.y))
  let y1 = Math.max(...pts.map((p) => p.y))
  if (y1 === y0) { y1 = y0 + (y0 === 0 ? 1 : Math.abs(y0) * 0.1); if (!zeroBased) y0 -= (y1 - y0) }
  const sx = (x: number) => PAD.left + (x1 === x0 ? (W - PAD.left - PAD.right) / 2 : ((x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right))
  const sy = (y: number) => PAD.top + (1 - (y - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom)

  // Break the line where a year is missing.
  const segments: { x: number; y: number }[][] = []
  let cur: { x: number; y: number }[] = []
  for (const d of data) {
    if (d.y == null) { if (cur.length) segments.push(cur); cur = [] } else cur.push({ x: d.x, y: d.y })
  }
  if (cur.length) segments.push(cur)

  // Drop ticks whose labels would repeat (e.g. a 0.5 midpoint on an integer axis).
  const ticks = [y0, (y0 + y1) / 2, y1].filter((t, i, all) => all.findIndex((o) => format(o) === format(t)) === i)
  const hovered = hover != null ? data[hover] : null
  const step = data.length > 1 ? sx(data[1].x) - sx(data[0].x) : W

  return (
    <figure className="chart">
      {header}
      <div className="chart-body">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} />
              <text className="axis" x={PAD.left - 6} y={sy(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const every = Math.ceil(data.length / (wide ? 14 : 7))
            if (i % every && d.x !== markX) return null
            return (
              <text key={d.x} className={`axis ${d.x === markX ? 'mark' : ''}`} x={sx(d.x)} y={H - 4} textAnchor="middle">
                {xFormat ? xFormat(d.x) : yearLabel(d.x, data.length > 6)}
              </text>
            )
          })}
          {markX != null && markX >= x0 && markX <= x1 && (
            <line className="mark-line" x1={sx(markX)} x2={sx(markX)} y1={PAD.top} y2={H - PAD.bottom} />
          )}
          {hovered && <line className="crosshair" x1={sx(hovered.x)} x2={sx(hovered.x)} y1={PAD.top} y2={H - PAD.bottom} />}
          {segments.map((s, i) => (
            <polyline key={i} className="series-line" points={s.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
          ))}
          {pts.map((p) => (
            (data.length <= 12 || p.x === markX || hovered?.x === p.x) && (
              <circle key={p.x} className="series-dot" cx={sx(p.x)} cy={sy(p.y)} r={hovered?.x === p.x ? 5 : 4} />
            )
          ))}
          {data.map((d, i) => (
            <rect key={d.x} x={sx(d.x) - step / 2} y={0} width={step} height={H} fill="transparent"
              onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hovered && (
          <div className="tooltip" style={{ left: `${(sx(hovered.x) / W) * 100}%` }}>
            <span className="muted">{xFormat ? xFormat(hovered.x) : hovered.x}</span> <b>{hovered.y == null ? 'no data' : format(hovered.y)}</b>
          </div>
        )}
      </div>
    </figure>
  )
}
