import { useMemo, useState } from 'react'
import { FACTORS, type FactorKey, type Settings, type Weights } from './scoring'
import type { Hunt } from './types'

export interface Filters {
  species: string
  tagTypes: string[] // empty = all
  access: 'all' | 'draw' | 'general'
  states: string[]
  weapons: string[]
  search: string
  minDrawOdds: number
  minSuccess: number
  minPublic: number
  maxPoints: number | null
}

interface Props {
  hunts: Hunt[]
  species: string
  speciesList: string[]
  licenseList: string[]
  available: FactorKey[]
  settings: Settings
  setSettings: (s: Settings) => void
  filters: Filters
  setFilters: (f: Filters) => void
  weights: Weights
  setWeights: (w: Weights) => void
  onReset: () => void
}

export default function Controls(p: Props) {
  const { settings, filters, weights } = p
  const [showWeights, setShowWeights] = useState(true)
  const states = useMemo(() => [...new Set(p.hunts.map((h) => h.state))].sort(), [p.hunts])
  const weapons = useMemo(
    () => [...new Set(p.hunts.filter((h) => h.species === p.species).map((h) => h.weapon ?? ''))]
      .filter(Boolean).sort(),
    [p.hunts, p.species],
  )
  const set = (patch: Partial<Filters>) => p.setFilters({ ...filters, ...patch })
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const totalWeight = FACTORS.reduce((a, f) => a + (p.available.includes(f.key) ? weights[f.key] : 0), 0)

  return (
    <section className="controls">
      <div className="control-row">
        <label className="field">
          <span>Species</span>
          <select value={p.species} onChange={(e) => set({ species: e.target.value, tagTypes: [], weapons: [] })}>
            {p.speciesList.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <fieldset className="field chips">
          <span>Draw or general</span>
          <div>
            {(['all', 'draw', 'general'] as const).map((a) => (
              <button key={a} className={`chip ${filters.access === a ? 'on' : ''}`} onClick={() => set({ access: a })}>
                {a === 'all' ? 'All' : a === 'draw' ? 'Draw' : 'General'}
              </button>
            ))}
          </div>
        </fieldset>

        {p.licenseList.length > 1 && (
          <fieldset className="field chips">
            <span>Tag type {filters.tagTypes.length === 0 && <span className="muted">(all)</span>}</span>
            <div>
              {p.licenseList.map((l) => (
                <button key={l} className={`chip ${filters.tagTypes.includes(l) ? 'on' : ''}`}
                  onClick={() => set({ tagTypes: toggle(filters.tagTypes, l) })}>{l}</button>
              ))}
            </div>
          </fieldset>
        )}

        {states.length > 1 && (
          <fieldset className="field chips">
            <span>State</span>
            <div>
              {states.map((s) => (
                <button key={s} className={`chip ${filters.states.includes(s) ? 'on' : ''}`}
                  onClick={() => set({ states: toggle(filters.states, s) })}>{s}</button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="field chips">
          <span>Residency</span>
          <div>
            {(['R', 'NR'] as const).map((r) => (
              <button key={r} className={`chip ${settings.residency === r ? 'on' : ''}`}
                onClick={() => p.setSettings({ ...settings, residency: r })}>
                {r === 'R' ? 'Resident' : 'Nonresident'}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field narrow">
          <span>My points</span>
          <input type="number" min={0} max={40} value={settings.points}
            onChange={(e) => p.setSettings({ ...settings, points: Math.max(0, Number(e.target.value) || 0) })} />
        </label>

        <label className="field narrow">
          <span>Years averaged</span>
          <select value={settings.years} onChange={(e) => p.setSettings({ ...settings, years: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n === 1 ? 'Latest' : `Last ${n}`}</option>)}
          </select>
        </label>

        {weapons.length > 1 && <fieldset className="field chips">
          <span>Weapon</span>
          <div>
            {weapons.map((w) => (
              <button key={w} className={`chip ${filters.weapons.includes(w) ? 'on' : ''}`}
                onClick={() => set({ weapons: toggle(filters.weapons, w) })}>{w}</button>
            ))}
          </div>
        </fieldset>}
      </div>

      <div className="control-row">
        <label className="field grow">
          <span>Search</span>
          <input type="search" placeholder="Unit, hunt code, or name" value={filters.search}
            onChange={(e) => set({ search: e.target.value })} />
        </label>
        <RangeField label="Min draw odds" value={filters.minDrawOdds} suffix="%" onChange={(v) => set({ minDrawOdds: v })} />
        <RangeField label="Min success" value={filters.minSuccess} suffix="%" onChange={(v) => set({ minSuccess: v })} />
        <RangeField label="Min public land" value={filters.minPublic} suffix="%" onChange={(v) => set({ minPublic: v })} />
        <label className="field narrow">
          <span>Max pts for 50%</span>
          <input type="number" min={0} placeholder="Any" value={filters.maxPoints ?? ''}
            onChange={(e) => set({ maxPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
        </label>
        <div className="field actions">
          <button className="link" onClick={() => setShowWeights(!showWeights)}>
            {showWeights ? 'Hide' : 'Show'} weights
          </button>
          <button className="link" onClick={p.onReset}>Reset</button>
        </div>
      </div>

      {showWeights && (
        <div className="weights">
          {FACTORS.map((f) => {
            const on = p.available.includes(f.key)
            return (
            <label key={f.key} className={`weight ${on ? '' : 'off'}`} title={on ? f.help : `${f.help} No data loaded for this yet.`}>
              <span className="weight-label">
                {f.label}
                <span className="muted">{!on ? 'no data' : totalWeight ? `${Math.round((weights[f.key] / totalWeight) * 100)}%` : '0%'}</span>
              </span>
              <input type="range" min={0} max={50} value={weights[f.key]}
                onChange={(e) => p.setWeights({ ...weights, [f.key]: Number(e.target.value) })} />
            </label>
            )
          })}
        </div>
      )}
    </section>
  )
}

function RangeField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <label className="field range">
      <span>{label} <b>{value}{suffix}</b></span>
      <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
