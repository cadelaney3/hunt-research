import type { DrawLevel, DrawSystem, Hunt, HuntYear, Residency } from './types'

export type FactorKey = 'draw' | 'success' | 'population' | 'quality' | 'crowding' | 'publicLand'

export const FACTORS: { key: FactorKey; label: string; help: string }[] = [
  { key: 'draw', label: 'Draw odds', help: 'Your first-choice chance of drawing at your point level (the raw %, not a rank). Bonus-point draws use a fitted lottery model.' },
  { key: 'success', label: 'Harvest success', help: 'Harvest ÷ hunters from post-season surveys. Montana data is district-wide (all hunters, including general tags), so it compares districts rather than predicting permit-holder success.' },
  { key: 'population', label: 'Population', help: 'Animals per sq mi (75%) and population trend over the years averaged (25%).' },
  { key: 'quality', label: 'Animal quality', help: 'Average of % mature males (e.g. 6+ pt bulls, 4+ pt bucks among harvested males), average age, males per 100 females, and your own rating, when present. Male-size metrics are ignored for antlerless/ewe tags.' },
  { key: 'crowding', label: 'Low crowding', help: 'Fewer hunters per sq mi scores higher.' },
  { key: 'publicLand', label: 'Public land', help: 'Share of the unit that is public land.' },
]

export type Weights = Record<FactorKey, number>

/** Stand-in for a factor a hunt has no data for (the median). */
const NEUTRAL = 0.5

export const DEFAULT_WEIGHTS: Weights = {
  draw: 25,
  success: 20,
  population: 15,
  quality: 25,
  crowding: 10,
  publicLand: 5,
}

export interface Settings {
  residency: Residency
  points: number
  years: number // how many recent years to average
}

/** Raw, human-readable metrics for one hunt under the current settings. */
export interface Metrics {
  drawOdds: number | null // 0..1
  ptsFor50: number | null // fewest points with ≥50% odds in the latest year; Infinity = not within 40, null = no draw data
  success: number | null // 0..1
  harvestChance: number | null // drawOdds × success
  density: number | null // animals / sq mi
  popTrend: number | null // fractional change, first→last of averaged years
  malesPer100: number | null
  matureMales: number | null // %
  avgAge: number | null
  rating: number | null
  huntersPerSqMi: number | null
  publicLand: number | null // %
  applicants: number | null // latest year, chosen residency, first choice
  appsPerTag: number | null // latest year, chosen residency: applicants ÷ successes
  quota: number | null
  successYears: number[] // survey years behind `success`
}

export interface Ranked {
  hunt: Hunt
  m: Metrics
  factors: Record<FactorKey, number | null> // 0..1 normalized, null = no data
  score: number | null // 0..100
  missing: FactorKey[]
  rank: number
}

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Odds of drawing at `points` from one year's results for one residency pool.
 *
 * - preference: tags go to the highest point levels first, so the observed
 *   rate at your level (or the nearest level below it) is the answer.
 * - bonus: a weighted lottery (Montana: points² + 1 chances). Per-level counts
 *   are noisy (often 1-5 applicants), so instead fit one parameter λ so the
 *   model reproduces the pool's total successes, then
 *   P(p) = 1 − exp(−λ·(p² + 1)). This is the standard approximation for weighted
 *   sampling without replacement; it fit Montana's 2026 results far better
 *   than (p+1)², linear, or flat weights.
 * - random: everyone has the same odds.
 */
export function drawOdds(levels: DrawLevel[], points: number, system: DrawSystem): number | null {
  const withApps = levels.filter((l) => l.applicants > 0)
  if (!withApps.length) return null
  if (system === 'bonus' || system === 'random') return lotteryModel(withApps, system)(points)

  // Exact level, else the closest level below you (you'd be at least that good),
  // else the lowest reported level (you're below everyone who applied).
  let best: DrawLevel | undefined
  for (const l of withApps) if (l.points <= points) best = l
  best ??= withApps[0]
  if (best.points < points && best.drawn === best.applicants) return 1
  return best.drawn / best.applicants
}

const lotteryWeight = (system: DrawSystem) => (system === 'bonus' ? (p: number) => p * p + 1 : () => 1)

const modelCache = new WeakMap<DrawLevel[], (points: number) => number>()

export function lotteryModel(levels: DrawLevel[], system: DrawSystem): (points: number) => number {
  const cached = modelCache.get(levels)
  if (cached) return cached
  const w = lotteryWeight(system)
  const apps = levels.reduce((a, l) => a + l.applicants, 0)
  const drawn = levels.reduce((a, l) => a + l.drawn, 0)
  let model: (p: number) => number
  if (drawn >= apps) model = () => 1
  else if (drawn === 0) model = () => 0
  else {
    const expected = (lam: number) => levels.reduce((a, l) => a + l.applicants * (1 - Math.exp(-lam * w(l.points))), 0)
    let lo = 0
    let hi = 1
    while (expected(hi) < drawn && hi < 1e6) hi *= 2
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (expected(mid) < drawn) lo = mid
      else hi = mid
    }
    const lam = (lo + hi) / 2
    model = (p) => 1 - Math.exp(-lam * w(p))
  }
  modelCache.set(levels, model)
  return model
}

/** Fewest points giving at least `target` odds (null if unreachable within 40 points). */
export function pointsFor(levels: DrawLevel[], system: DrawSystem, target = 0.5): number | null {
  if (!levels.some((l) => l.applicants > 0)) return null
  for (let p = 0; p <= 40; p++) {
    const o = drawOdds(levels, p, system)
    if (o != null && o >= target - 1e-9) return p
  }
  return null
}

/**
 * Mean of `f` over the last `n` years that have a value for it. Each metric
 * picks its own years: draw results, harvest surveys and hunter estimates are
 * published on different schedules (e.g. FWP counts elk hunters only in even
 * years), so "last 3 years" of calendar rows would often hold one data point.
 */
function recentMean(hunt: Hunt, n: number, f: (y: HuntYear) => number | null | undefined) {
  const vals: number[] = []
  const years: number[] = []
  for (let i = hunt.years.length - 1; i >= 0 && vals.length < n; i--) {
    const v = f(hunt.years[i])
    if (v != null && Number.isFinite(v)) {
      vals.push(v)
      years.push(hunt.years[i].year)
    }
  }
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, years, vals }
}

export const successOf = (y: HuntYear) => (y.hunters && y.harvest != null ? y.harvest / y.hunters : null)

export function computeMetrics(hunt: Hunt, s: Settings): Metrics {
  const n = s.years
  const latestDraw = [...hunt.years].reverse().find((y) => y.draw[s.residency]?.length)
  const latestLevels = latestDraw?.draw[s.residency] ?? []
  const apps = latestLevels.reduce((a, l) => a + l.applicants, 0)
  const drawn = latestLevels.reduce((a, l) => a + l.drawn, 0)
  // Antler/horn size says nothing about a cow, doe or ewe tag.
  const maleQuality = hunt.sex !== 'female'

  // General licenses aren't drawn: anyone can buy one.
  const general = hunt.draw_system === 'general'
  const odds = general
    ? { value: 1 }
    : recentMean(hunt, n, (y) => drawOdds(y.draw[s.residency] ?? [], s.points, hunt.draw_system))
  const success = recentMean(hunt, n, successOf)
  const density = recentMean(hunt, n, (y) => y.pop_density)
  const dens = [...density.vals].reverse()
  const popTrend = dens.length >= 2 && dens[0] > 0 ? dens[dens.length - 1] / dens[0] - 1 : null
  const hunters = recentMean(hunt, n, (y) => y.hunters).value

  return {
    drawOdds: odds.value,
    ptsFor50: general ? 0 : latestDraw ? pointsFor(latestLevels, hunt.draw_system) ?? Infinity : null,
    success: success.value,
    harvestChance: odds.value != null && success.value != null ? odds.value * success.value : null,
    density: density.value,
    popTrend,
    malesPer100: maleQuality ? recentMean(hunt, n, (y) => y.males_per_100_females).value : null,
    matureMales: maleQuality ? recentMean(hunt, n, (y) => y.pct_mature_males).value : null,
    avgAge: maleQuality ? recentMean(hunt, n, (y) => y.avg_age).value : null,
    rating: recentMean(hunt, n, (y) => y.rating).value,
    huntersPerSqMi: hunters != null && hunt.area_sq_mi ? hunters / hunt.area_sq_mi : null,
    publicLand: hunt.public_land_pct,
    applicants: latestDraw ? apps : null,
    appsPerTag: drawn ? apps / drawn : null,
    quota: latestDraw?.quota ?? null,
    successYears: success.years,
  }
}

/** Percentile rank in 0..1 (ties share their average rank); null stays null. */
function percentiles(values: (number | null)[], higherIsBetter = true): (number | null)[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null)
    .sort((a, b) => a.v - b.v)
  const out: (number | null)[] = values.map(() => null)
  if (present.length === 1) out[present[0].i] = 1
  for (let start = 0; start < present.length && present.length > 1; ) {
    let end = start
    while (end + 1 < present.length && present[end + 1].v === present[start].v) end++
    const p = (start + end) / 2 / (present.length - 1)
    for (let k = start; k <= end; k++) out[present[k].i] = higherIsBetter ? p : 1 - p
    start = end + 1
  }
  return out
}

/**
 * Score every hunt in `universe` (one species + residency). Percentiles are
 * taken across the whole universe, so narrowing the table with filters hides
 * rows without changing anyone's score.
 */
export function rankHunts(universe: Hunt[], s: Settings, w: Weights): { rows: Ranked[]; available: FactorKey[] } {
  const ms = universe.map((h) => computeMetrics(h, s))
  const col = <K extends keyof Metrics>(k: K) => ms.map((m) => m[k] as number | null)

  const density = percentiles(col('density'))
  const trend = percentiles(col('popTrend'))
  const qualityParts = [
    percentiles(col('matureMales')),
    percentiles(col('avgAge')),
    percentiles(col('malesPer100')),
    col('rating').map((r) => (r == null ? null : (r - 1) / 4)), // 1-5 scale, absolute
  ]
  const success = percentiles(col('success'))
  const crowding = percentiles(col('huntersPerSqMi'), false)
  const publicLand = col('publicLand').map((p) => (p == null ? null : p / 100))

  const factorsByHunt = universe.map((_, i) => {
    const population =
      density[i] == null ? null : trend[i] == null ? density[i] : 0.75 * density[i]! + 0.25 * trend[i]!
    const factors: Record<FactorKey, number | null> = {
      draw: ms[i].drawOdds,
      success: success[i],
      population,
      quality: mean(qualityParts.map((p) => p[i])),
      crowding: crowding[i],
      publicLand: publicLand[i],
    }
    return factors
  })
  // A factor nobody in scope has data for is left out entirely rather than
  // flagging every row as incomplete.
  const available = FACTORS.map((f) => f.key).filter((k) => factorsByHunt.some((f) => f[k] != null))

  const ranked: Ranked[] = universe.map((hunt, i) => {
    const factors = factorsByHunt[i]
    let num = 0
    let den = 0
    const missing: FactorKey[] = []
    for (const f of FACTORS) {
      if (!w[f.key] || !available.includes(f.key)) continue
      // Missing for this hunt but known for others: count it as average, so a
      // hunt can't rank high just because its weak spots weren't measured.
      let v = factors[f.key]
      if (v == null) {
        missing.push(f.key)
        v = NEUTRAL
      }
      num += v * w[f.key]
      den += w[f.key]
    }
    return { hunt, m: ms[i], factors, score: den ? (num / den) * 100 : null, missing, rank: 0 }
  })

  ranked
    .slice()
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .forEach((r, i) => (r.rank = i + 1))
  return { rows: ranked, available }
}
