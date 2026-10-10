// Browser-side implementations of the tools declared in server/tools.ts.
// They reuse the table's scoring, so the assistant's numbers match the table.

import type { Filters } from '../Controls'
import {
  drawOdds, FACTORS, lotteryModel, rankHunts, successOf,
  type Ranked, type Settings, type Weights,
} from '../scoring'
import type { Dataset, Hunt, Residency } from '../types'

export interface ViewChange {
  filters: Partial<Filters>
  sort?: { id: string; desc: boolean }
  openHuntId?: string
}

export interface ToolContext {
  data: Dataset
  settings: Settings
  weights: Weights
  currentSpecies: string
  applyView: (v: ViewChange) => void
}

export interface ToolOutcome {
  content: string
  isError?: boolean
  /** Short line shown in the chat while the assistant works. */
  activity: string
}

// sort key -> table column id, value, and whether higher is better
const SORTS: Record<string, { col: string; get: (r: Ranked) => number | null; higherBetter: boolean }> = {
  score: { col: 'score', get: (r) => r.score, higherBetter: true },
  draw_odds: { col: 'draw', get: (r) => r.m.drawOdds, higherBetter: true },
  pts_for_50: { col: 'pts', get: (r) => r.m.ptsFor50, higherBetter: false },
  success: { col: 'success', get: (r) => r.m.success, higherBetter: true },
  draw_x_success: { col: 'harvestChance', get: (r) => r.m.harvestChance, higherBetter: true },
  density: { col: 'density', get: (r) => r.m.density, higherBetter: true },
  mature: { col: 'mature', get: (r) => r.m.matureMales, higherBetter: true },
  public: { col: 'public', get: (r) => r.m.publicLand, higherBetter: true },
  crowding: { col: 'crowding', get: (r) => r.m.huntersPerSqMi, higherBetter: false },
  applicants: { col: 'applicants', get: (r) => r.m.applicants, higherBetter: true },
  apps_per_tag: { col: 'appsPerTag', get: (r) => r.m.appsPerTag, higherBetter: false },
}

class ToolInputError extends Error {}

export function runTool(name: string, rawInput: unknown, ctx: ToolContext): ToolOutcome {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>
  try {
    switch (name) {
      case 'describe_data':
        return { content: json(describeData(ctx)), activity: 'Checked what data is loaded' }
      case 'search_hunts': {
        const out = searchHunts(input, ctx)
        return { content: json(out), activity: `Searched ${out.species} hunts (${out.total_matches} matches)` }
      }
      case 'get_hunt': {
        const out = getHunt(input, ctx)
        return { content: json(out), activity: `Looked up ${out.hunt_code}` }
      }
      case 'show_in_table': {
        showInTable(input, ctx)
        return { content: json({ ok: true }), activity: 'Updated the table view' }
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true, activity: `Unknown tool ${name}` }
    }
  } catch (e) {
    const msg = e instanceof ToolInputError ? e.message : `Tool failed: ${String(e)}`
    return { content: msg, isError: true, activity: `${name}: ${msg}` }
  }
}

// ---------------------------------------------------------------- describe_data

function describeData(ctx: ToolContext) {
  const species: Record<string, { hunts: number; tag_types: Record<string, { draw: number; general: number }> }> = {}
  for (const h of ctx.data.hunts) {
    const s = (species[h.species] ??= { hunts: 0, tag_types: {} })
    s.hunts++
    const t = (s.tag_types[h.license] ??= { draw: 0, general: 0 })
    t[h.draw_system === 'general' ? 'general' : 'draw']++
  }
  const coverage = (sp: string) => {
    const hs = ctx.data.hunts.filter((h) => h.species === sp)
    const has = (f: (y: Hunt['years'][number]) => unknown) => hs.filter((h) => h.years.some((y) => f(y) != null)).length
    return {
      with_harvest: has((y) => y.harvest),
      with_population: has((y) => y.pop_density),
      with_mature_pct: has((y) => y.pct_mature_males),
      with_land: hs.filter((h) => h.public_land_pct != null).length,
    }
  }
  return {
    states: [...new Set(ctx.data.hunts.map((h) => h.state))],
    built: ctx.data.generated_at,
    species: Object.fromEntries(Object.entries(species).map(([sp, v]) => [sp, { ...v, coverage: coverage(sp) }])),
    table_settings: {
      residency: ctx.settings.residency,
      points: ctx.settings.points,
      years_averaged: ctx.settings.years,
      species_shown: ctx.currentSpecies,
      score_weights_pct: weightShares(ctx.weights),
    },
  }
}

// ---------------------------------------------------------------- search_hunts

function searchHunts(input: Record<string, unknown>, ctx: ToolContext) {
  const species = speciesArg(input.species, ctx)
  const settings = settingsArg(input, ctx)
  const universe = ctx.data.hunts.filter((h) => h.species === species)
  const { rows } = rankHunts(universe, settings, ctx.weights)

  const tagTypes = tagTypesArg(input.tag_types, universe)
  const access = enumArg(input.access, ['all', 'draw', 'general'], 'access') ?? 'all'
  const units = strList(input.units, 'units')
  const min = (key: string) => numArg(input[key], key)
  const minOdds = min('min_draw_odds_pct')
  const maxPts = min('max_points_for_50')
  const minSucc = min('min_success_pct')
  const minMature = min('min_mature_pct')
  const minPublic = min('min_public_pct')
  const minDensity = min('min_density')
  const maxCrowd = min('max_hunters_per_sq_mi')

  const matches = rows.filter(({ hunt, m }) => {
    const general = hunt.draw_system === 'general'
    if (tagTypes && !tagTypes.includes(hunt.license)) return false
    if (access !== 'all' && general !== (access === 'general')) return false
    if (units && !hunt.units.some((u) => units.includes(u))) return false
    if (input.exclude_permit_districts === true && general && hunt.permit_overlap?.length) return false
    if (minOdds != null && (m.drawOdds ?? 0) * 100 < minOdds) return false
    if (maxPts != null && (m.ptsFor50 ?? Infinity) > maxPts) return false
    if (minSucc != null && (m.success ?? -1) * 100 < minSucc) return false
    if (minMature != null && (m.matureMales ?? -1) < minMature) return false
    if (minPublic != null && (m.publicLand ?? -1) < minPublic) return false
    if (minDensity != null && (m.density ?? -1) < minDensity) return false
    if (maxCrowd != null && (m.huntersPerSqMi ?? Infinity) > maxCrowd) return false
    return true
  })

  const sortKey = enumArg(input.sort_by, Object.keys(SORTS), 'sort_by') ?? 'score'
  const sort = SORTS[sortKey]
  const dirArg = enumArg(input.sort_dir, ['asc', 'desc'], 'sort_dir')
  const desc = dirArg ? dirArg === 'desc' : sort.higherBetter
  matches.sort((a, b) => {
    const va = sort.get(a)
    const vb = sort.get(b)
    if (va == null && vb == null) return a.rank - b.rank
    if (va == null) return 1 // blanks last either way
    if (vb == null) return -1
    return (desc ? vb - va : va - vb) || a.rank - b.rank
  })

  const limit = Math.min(50, Math.max(1, numArg(input.limit, 'limit') ?? 15))
  return {
    species,
    assumptions: { residency: settings.residency, points: settings.points, years_averaged: settings.years },
    sorted_by: `${sortKey} ${desc ? 'desc' : 'asc'}`,
    total_matches: matches.length,
    returned: Math.min(limit, matches.length),
    ranked_out_of: rows.length,
    hunts: matches.slice(0, limit).map(summarize),
  }
}

function summarize(r: Ranked) {
  const { hunt, m } = r
  const general = hunt.draw_system === 'general'
  return compact({
    hunt_id: hunt.id,
    hunt_code: hunt.hunt_code,
    units: hunt.units.join(', '),
    unit_name: hunt.unit_info.map((u) => u.name).filter(Boolean).join(' + ') || undefined,
    tag_type: hunt.license,
    access: general ? 'general' : 'draw',
    rank: r.rank,
    score: round(r.score, 0),
    draw_odds_pct: general ? 100 : pct(m.drawOdds, 1),
    pts_for_50: general ? 0 : m.ptsFor50 === Infinity ? '40+' : m.ptsFor50,
    apps_per_tag: round(m.appsPerTag, 1),
    applicants: m.applicants,
    success_pct: pct(m.success, 0),
    mature_pct: round(m.matureMales, 0),
    density_per_sq_mi: round(m.density, 2),
    public_pct: round(m.publicLand, 0),
    hunters_per_sq_mi: round(m.huntersPerSqMi, 2),
    notes: hunt.notes ?? undefined,
    permit_district: general && hunt.permit_overlap?.length ? hunt.permit_overlap.join(', ') : undefined,
    no_data_for: r.missing.length ? r.missing.join(', ') : undefined,
  })
}

// ---------------------------------------------------------------- get_hunt

function getHunt(input: Record<string, unknown>, ctx: ToolContext) {
  const id = String(input.hunt_id ?? '')
  const hunt = ctx.data.hunts.find((h) => h.id === id)
    ?? ctx.data.hunts.find((h) => h.hunt_code.toLowerCase() === id.toLowerCase())
  if (!hunt) throw new ToolInputError(`No hunt with id ${JSON.stringify(id)}. Use search_hunts to find hunt_ids.`)
  const settings = settingsArg(input, ctx)
  const { rows, available } = rankHunts(ctx.data.hunts.filter((h) => h.species === hunt.species), settings, ctx.weights)
  const r = rows.find((x) => x.hunt.id === hunt.id)!
  const res: Residency = settings.residency
  const general = hunt.draw_system === 'general'
  const latestDraw = [...hunt.years].reverse().find((y) => y.draw[res]?.length)
  const levels = latestDraw?.draw[res] ?? []
  const model = levels.length && hunt.draw_system !== 'preference' ? lotteryModel(levels, hunt.draw_system) : null
  const shares = weightShares(ctx.weights, available)

  return {
    ...summarize(r),
    assumptions: { residency: res, points: settings.points, years_averaged: settings.years },
    species: hunt.species,
    draw_system: hunt.draw_system,
    ranked_out_of: rows.length,
    score_breakdown: Object.fromEntries(
      FACTORS.filter((f) => available.includes(f.key)).map((f) => [f.key, {
        rating_0_100: r.factors[f.key] == null ? 'no data (counted as 50)' : round(r.factors[f.key]! * 100, 0),
        weight_pct: shares[f.key],
      }]),
    ),
    draw: general ? 'General license: no draw.' : latestDraw ? {
      year: latestDraw.year,
      quota_all_pools: latestDraw.quota,
      first_choice_applicants: levels.reduce((a, l) => a + l.applicants, 0),
      drawn: levels.reduce((a, l) => a + l.drawn, 0),
      by_points: levels.filter((l) => l.applicants > 0).map((l) => compact({
        points: l.points, applicants: l.applicants, drawn: l.drawn,
        observed_pct: pct(l.drawn / l.applicants, 0),
        modeled_pct: model ? pct(model(l.points), 1) : undefined,
      })),
      odds_pct_by_points: Object.fromEntries(
        Array.from({ length: 31 }, (_, p) => [p, pct(drawOdds(levels, p, hunt.draw_system), 1)]),
      ),
    } : 'No draw results for this residency.',
    harvest_by_year: hunt.years.filter((y) => y.harvest != null).map((y) => compact({
      year: y.year,
      hunters: y.hunters ?? 'not estimated',
      harvest: y.harvest,
      success_pct: pct(successOf(y), 0),
      males: y.males ?? undefined,
      mature_pct: round(y.pct_mature_males, 0),
      districts: y.harvest_units?.join('+'),
    })),
    herd: [...hunt.years].reverse().find((y) => y.herd_info?.length)?.herd_info,
    land: hunt.unit_info.map((u) => compact({
      unit: u.unit, name: u.name ?? undefined, area_sq_mi: round(u.area_sq_mi, 0),
      public_pct: round(u.public_land_pct, 0), ownership_and_cover: u.notes ?? undefined,
    })),
    quality_notes: hunt.quality_notes.length ? hunt.quality_notes : undefined,
  }
}

// ---------------------------------------------------------------- show_in_table

function showInTable(input: Record<string, unknown>, ctx: ToolContext) {
  const species = speciesArg(input.species, ctx)
  const universe = ctx.data.hunts.filter((h) => h.species === species)
  const sortKey = enumArg(input.sort_by, Object.keys(SORTS), 'sort_by')
  const dir = enumArg(input.sort_dir, ['asc', 'desc'], 'sort_dir')
  const open = input.open_hunt_id != null ? String(input.open_hunt_id) : undefined
  if (open && !ctx.data.hunts.some((h) => h.id === open)) throw new ToolInputError(`No hunt with id ${JSON.stringify(open)}.`)
  ctx.applyView({
    filters: {
      species,
      tagTypes: tagTypesArg(input.tag_types, universe) ?? [],
      access: (enumArg(input.access, ['all', 'draw', 'general'], 'access') ?? 'all') as Filters['access'],
      search: input.search != null ? String(input.search) : '',
      minDrawOdds: numArg(input.min_draw_odds_pct, 'min_draw_odds_pct') ?? 0,
      minSuccess: numArg(input.min_success_pct, 'min_success_pct') ?? 0,
      minPublic: numArg(input.min_public_pct, 'min_public_pct') ?? 0,
      maxPoints: numArg(input.max_points_for_50, 'max_points_for_50') ?? null,
      weapons: [],
    },
    sort: sortKey ? { id: SORTS[sortKey].col, desc: dir ? dir === 'desc' : SORTS[sortKey].higherBetter } : undefined,
    openHuntId: open,
  })
}

// ---------------------------------------------------------------- argument helpers

function speciesArg(v: unknown, ctx: ToolContext): string {
  const all = [...new Set(ctx.data.hunts.map((h) => h.species))]
  const s = String(v ?? '').toLowerCase().trim()
  const match = all.find((x) => x === s) ?? all.find((x) => x.includes(s) || s.includes(x))
  if (!s || !match) throw new ToolInputError(`Unknown species ${JSON.stringify(v)}. Available: ${all.join(', ')}.`)
  return match
}

function tagTypesArg(v: unknown, universe: Hunt[]): string[] | undefined {
  const list = strList(v, 'tag_types')
  if (!list?.length) return undefined
  const valid = [...new Set(universe.map((h) => h.license))]
  const out = list.map((t) => valid.find((x) => x.toLowerCase() === t.toLowerCase()))
  const bad = list.filter((_, i) => !out[i])
  if (bad.length) throw new ToolInputError(`Unknown tag type(s) ${JSON.stringify(bad)}. Valid for this species: ${valid.join(', ')}.`)
  return out as string[]
}

function settingsArg(input: Record<string, unknown>, ctx: ToolContext): Settings {
  return {
    residency: (enumArg(input.residency, ['R', 'NR'], 'residency') as Residency | undefined) ?? ctx.settings.residency,
    points: numArg(input.points, 'points') ?? ctx.settings.points,
    years: ctx.settings.years,
  }
}

function enumArg(v: unknown, allowed: string[], name: string): string | undefined {
  if (v == null || v === '') return undefined
  if (!allowed.includes(String(v))) throw new ToolInputError(`${name} must be one of ${allowed.join(', ')}.`)
  return String(v)
}

function numArg(v: unknown, name: string): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new ToolInputError(`${name} must be a number.`)
  return n
}

function strList(v: unknown, name: string): string[] | undefined {
  if (v == null) return undefined
  if (!Array.isArray(v)) throw new ToolInputError(`${name} must be an array of strings.`)
  return v.map(String)
}

function weightShares(w: Weights, keys = FACTORS.map((f) => f.key)) {
  const total = keys.reduce((a, k) => a + w[k], 0) || 1
  return Object.fromEntries(keys.map((k) => [k, Math.round((w[k] / total) * 100)])) as Record<string, number>
}

const round = (v: number | null | undefined, d: number) => (v == null || !Number.isFinite(v) ? undefined : Number(v.toFixed(d)))
const pct = (v: number | null | undefined, d: number) => round(v == null ? null : v * 100, d)
const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>
const json = (v: unknown) => JSON.stringify(v)
