import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { fmt } from './format'
import type { Ranked } from './scoring'

const col = createColumnHelper<Ranked>()
// TanStack only sorts `undefined` to the end, so map null → undefined.
const u = (v: number | null) => v ?? undefined

const columns = [
  col.accessor('rank', { header: '#', cell: (c) => <span className="muted">{c.getValue()}</span> }),
  col.accessor((r) => r.hunt.units.join(', '), {
    id: 'unit',
    header: 'Unit',
    cell: (c) => (
      <div>
        <div className="strong">{c.row.original.hunt.units.length > 1 ? 'Units' : 'Unit'} {c.getValue()}</div>
        <div className="muted small">
          {c.row.original.hunt.state} · {c.row.original.hunt.draw_system === 'general'
            ? `HD ${c.row.original.hunt.units.join(', ')}`
            : c.row.original.hunt.hunt_code.replace(/^.*?(?=\d{3}-\d{2})/, '')}
        </div>
      </div>
    ),
  }),
  col.accessor((r) => r.hunt.season ?? r.hunt.license, {
    id: 'season',
    header: 'Tag',
    cell: (c) => {
      const h = c.row.original.hunt
      const showWeapon = h.weapon !== 'any' && !h.notes?.toLowerCase().includes(h.weapon ?? '')
      const sub = [h.season && h.license, showWeapon && h.weapon, h.notes].filter(Boolean).join(' · ')
      const general = h.draw_system === 'general'
      return (
        <div>
          <div>
            <span className={`badge access ${general ? 'general' : 'draw'}`}>{general ? 'General' : 'Draw'}</span>
            {c.getValue()}
          </div>
          {sub && !general && <div className="muted small">{sub}</div>}
          {general && h.permit_overlap?.length ? (
            <div className="small caution" title={`Draw permits here: ${h.permit_overlap.join(', ')}. Harvest and quality stats include permit holders.`}>
              ⚠ Permit district: check regs
            </div>
          ) : null}
        </div>
      )
    },
  }),
  col.accessor((r) => u(r.score), {
    id: 'score',
    header: 'Score',
    sortUndefined: 'last',
    cell: (c) => {
      const v = c.getValue()
      const { missing } = c.row.original
      return (
        <div className="score" title={missing.length ? `No data for: ${missing.join(', ')} (counted as average)` : undefined}>
          <span className="num">{v == null ? '–' : Math.round(v)}</span>
          <span className="meter"><span style={{ width: `${v ?? 0}%` }} /></span>
          {missing.length > 0 && <span className="partial" aria-label="partial data">*</span>}
        </div>
      )
    },
  }),
  col.accessor((r) => u(r.m.drawOdds), { id: 'draw', header: 'Your odds', sortUndefined: 'last', cell: (c) => fmt.odds(c.getValue()) }),
  col.accessor((r) => u(r.m.ptsFor50), {
    id: 'pts', header: 'Pts for 50%', sortUndefined: 'last',
    cell: (c) => (c.getValue() == null ? '40+' : fmt.int(c.getValue())),
    meta: { title: 'Fewest points giving at least 50% draw odds in the latest year' },
  }),
  col.accessor((r) => u(r.m.appsPerTag), {
    id: 'appsPerTag', header: 'Apps / tag', sortUndefined: 'last',
    cell: (c) => fmt.num(c.getValue(), 1),
    meta: { title: 'First-choice applicants per tag drawn, latest year, your residency' },
  }),
  col.accessor((r) => u(r.m.applicants), {
    id: 'applicants', header: 'Applicants', sortUndefined: 'last',
    cell: (c) => fmt.int(c.getValue()),
    meta: { title: 'First-choice applicants, latest year, your residency' },
  }),
  col.accessor((r) => u(r.m.success), {
    id: 'success', header: 'Success', sortUndefined: 'last', cell: (c) => fmt.pct(c.getValue()),
    meta: { title: 'Harvest ÷ hunters, averaged over survey years with a hunter estimate. Montana: district-wide, all hunters.' },
  }),
  col.accessor((r) => u(r.m.harvestChance), {
    id: 'harvestChance', header: 'Draw × success', sortUndefined: 'last',
    cell: (c) => fmt.pct(c.getValue(), 1),
    meta: { title: 'Chance of drawing and then harvesting this year' },
  }),
  col.accessor((r) => u(r.m.density), {
    id: 'density', header: 'Per sq mi', sortUndefined: 'last',
    cell: (c) => (
      <span>
        {fmt.num(c.getValue(), 1)} <Trend v={c.row.original.m.popTrend} />
      </span>
    ),
    meta: { title: 'Population density, with trend over the averaged years' },
  }),
  col.accessor((r) => u(r.m.malesPer100), { id: 'ratio', header: 'M:100F', sortUndefined: 'last', cell: (c) => fmt.num(c.getValue(), 0) }),
  col.accessor((r) => u(r.m.matureMales), {
    id: 'mature', header: 'Mature ♂', sortUndefined: 'last', cell: (c) => fmt.pct100(c.getValue()),
    meta: { title: 'Share of harvested males that were mature (elk 6+ pts, deer 4+ pts)' },
  }),
  col.accessor((r) => u(r.m.rating), { id: 'rating', header: 'Rating', sortUndefined: 'last', cell: (c) => fmt.num(c.getValue(), 1) }),
  col.accessor((r) => u(r.m.publicLand), { id: 'public', header: 'Public', sortUndefined: 'last', cell: (c) => fmt.pct100(c.getValue()) }),
  col.accessor((r) => u(r.m.huntersPerSqMi), {
    id: 'crowding', header: 'Hunters / sq mi', sortUndefined: 'last', cell: (c) => fmt.num(c.getValue(), 2),
  }),
]

function Trend({ v }: { v: number | null }) {
  if (v == null || Math.abs(v) < 0.03) return null
  return (
    <span className={`trend ${v > 0 ? 'up' : 'down'}`} title={`${v > 0 ? '+' : ''}${Math.round(v * 100)}% over period`}>
      {v > 0 ? '▲' : '▼'}
    </span>
  )
}

interface Props {
  rows: Ranked[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function RankTable({ rows, selectedId, onSelect }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'rank', desc: false }])
  // Hide metric columns that are empty for every row (e.g. no harvest data loaded yet).
  const columnVisibility = useMemo(() => {
    const vis: Record<string, boolean> = {}
    for (const c of columns) {
      const id = c.id!
      if (['rank', 'unit', 'season', 'score'].includes(id) || !('accessorFn' in c) || !c.accessorFn) continue
      vis[id] = rows.some((r, i) => c.accessorFn!(r, i) !== undefined)
    }
    return vis
  }, [rows])
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.hunt.id,
  })

  if (!rows.length) return <div className="empty">No hunts match these filters.</div>

  return (
    <div className="table-wrap">
      <table className="rank-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted()
                return (
                  <th key={h.id} className={`col-${h.column.id}`}
                    title={(h.column.columnDef.meta as { title?: string } | undefined)?.title}
                    aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <span className="sort">{sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.id === selectedId ? 'selected' : ''}
              onClick={() => onSelect(row.id)} tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(row.id)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={`col-${cell.column.id}`}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
