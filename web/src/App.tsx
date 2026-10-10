import type { SortingState } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ChatPanel from './ai/ChatPanel'
import type { ToolContext, ViewChange } from './ai/tools'
import Controls, { type Filters } from './Controls'
import HuntDetail from './HuntDetail'
import RankTable from './RankTable'
import { DEFAULT_WEIGHTS, FACTORS, rankHunts, type Settings, type Weights } from './scoring'
import type { Dataset } from './types'
import { useHashSelection, usePersistentState } from './usePersistentState'

const DEFAULT_SETTINGS: Settings = { residency: 'R', points: 0, years: 3 }
const DEFAULT_FILTERS: Filters = {
  species: '',
  tagTypes: [],
  access: 'all',
  states: [],
  weapons: [],
  search: '',
  minDrawOdds: 0,
  minSuccess: 0,
  minPublic: 0,
  maxPoints: null,
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = usePersistentState('settings', DEFAULT_SETTINGS)
  const [weights, setWeights] = usePersistentState<Weights>('weights', DEFAULT_WEIGHTS)
  const [filters, setFilters] = usePersistentState('filters', DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useHashSelection()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'rank', desc: false }])
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/hunts.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  const speciesList = useMemo(() => [...new Set(data?.hunts.map((h) => h.species))].sort(), [data])
  const species = speciesList.includes(filters.species) ? filters.species : speciesList[0] ?? ''
  // Tag types for this species: draw tags first, antlerless/doe last.
  const licenseList = useMemo(() => {
    const rank = new Map<string, number>()
    for (const h of data?.hunts ?? [])
      if (h.species === species) rank.set(h.license, (h.draw_system === 'general' ? 1 : 0) + (h.sex === 'female' ? 2 : 0))
    return [...rank].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([l]) => l)
  }, [data, species])

  // The scoring universe: every hunt for one species in the chosen states, so
  // draw and general hunts are ranked on the same scale. Other filters only hide rows.
  const universe = useMemo(
    () =>
      (data?.hunts ?? []).filter(
        (h) => h.species === species && (!filters.states.length || filters.states.includes(h.state)),
      ),
    [data, species, filters.states],
  )
  const { rows: ranked, available } = useMemo(() => rankHunts(universe, settings, weights), [universe, settings, weights])
  const unavailable = FACTORS.filter((f) => !available.includes(f.key)).map((f) => f.label.toLowerCase())

  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return ranked.filter(({ hunt, m }) => {
      if (filters.tagTypes.length && !filters.tagTypes.includes(hunt.license)) return false
      if (filters.access !== 'all' && (hunt.draw_system === 'general') !== (filters.access === 'general')) return false
      if (filters.weapons.length && !filters.weapons.includes(hunt.weapon ?? '')) return false
      if (q && ![hunt.hunt_code, ...hunt.units, ...hunt.unit_info.map((u) => u.name ?? '')]
        .some((s) => s.toLowerCase().includes(q))) return false
      if (filters.minDrawOdds && (m.drawOdds ?? 0) * 100 < filters.minDrawOdds) return false
      if (filters.minSuccess && (m.success ?? 0) * 100 < filters.minSuccess) return false
      if (filters.minPublic && (m.publicLand ?? 0) < filters.minPublic) return false
      if (filters.maxPoints != null && (m.ptsFor50 ?? Infinity) > filters.maxPoints) return false
      return true
    })
  }, [ranked, filters])

  // A bookmarked hunt from another species switches the view to it.
  const linked = data?.hunts.find((h) => h.id === selectedId)
  useEffect(() => {
    if (linked && linked.species !== species) {
      setFilters((f) => ({ ...f, species: linked.species, tagTypes: [], access: 'all', weapons: [] }))
    }
  }, [linked, species, setFilters])

  const selected = ranked.find((r) => r.hunt.id === selectedId) ?? null

  // The assistant can change what the table shows (filters, sort, open hunt).
  const applyView = useCallback((v: ViewChange) => {
    setFilters((f) => ({ ...f, ...v.filters }))
    if (v.sort) setSorting([v.sort])
    if (v.openHuntId) setSelectedId(v.openHuntId)
  }, [setFilters, setSelectedId])
  const toolCtx = useMemo<ToolContext | null>(
    () => (data ? { data, settings, weights, currentSpecies: species, applyView } : null),
    [data, settings, weights, species, applyView],
  )

  if (error) return <div className="empty">Couldn’t load data/hunts.json: {error}. Run <code>python -m ingest build</code>.</div>
  if (!data) return <div className="empty">Loading…</div>

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Hunt Unit Ranker</h1>
          <p className="sub">
            {data.hunts.length} hunts · built {new Date(data.generated_at).toLocaleDateString()}
            {data.source === 'sample' && <span className="badge warn">Sample data: fictional units</span>}
            {data.warnings.length > 0 && (
              <span className="badge" title={data.warnings.join('\n')}>{data.warnings.length} data warnings</span>
            )}
          </p>
        </div>
        {import.meta.env.DEV && !chatOpen && (
          <button className="ask-button" onClick={() => setChatOpen(true)}>Ask the data</button>
        )}
      </header>

      <Controls
        hunts={data.hunts}
        species={species}
        speciesList={speciesList}
        licenseList={licenseList}
        available={available}
        settings={settings}
        setSettings={setSettings}
        filters={filters}
        setFilters={setFilters}
        weights={weights}
        setWeights={setWeights}
        onReset={() => {
          setFilters({ ...DEFAULT_FILTERS, species })
          setWeights(DEFAULT_WEIGHTS)
        }}
      />

      <main className="main">
        <div className="table-meta">
          Showing {visible.length} of {ranked.length} {species} hunts · scores use {settings.residency === 'R' ? 'resident' : 'nonresident'} odds
          at {settings.points} point{settings.points === 1 ? '' : 's'}, averaged over the last {settings.years} year{settings.years === 1 ? '' : 's'}
          {unavailable.length > 0 && (
            <div className="notice">
              Scoring on {FACTORS.filter((f) => available.includes(f.key)).map((f) => f.label.toLowerCase()).join(', ') || 'nothing'}.
              No {unavailable.join(', ')} data is loaded for these hunts yet.
            </div>
          )}
        </div>
        <RankTable rows={visible} selectedId={selectedId} onSelect={setSelectedId} sorting={sorting} onSortingChange={setSorting} />
      </main>

      {selected && (
        <HuntDetail
          row={selected}
          settings={settings}
          weights={weights}
          available={available}
          onClose={() => setSelectedId(null)}
        />
      )}

      {chatOpen && toolCtx && (
        <ChatPanel ctx={toolCtx} onOpenHunt={setSelectedId} onClose={() => setChatOpen(false)} />
      )}
    </div>
  )
}
