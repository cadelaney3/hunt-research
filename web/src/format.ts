type N = number | null | undefined

export const fmt = {
  /** 0..1 fraction → "42%" */
  pct: (v: N, digits = 0) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`),
  /** Odds: one decimal below 10% so long-shot hunts stay distinguishable. */
  odds: (v: N) => (v == null ? '–' : v > 0 && v < 0.0005 ? '<0.1%' : `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`),
  /** already-percent number → "42%" */
  pct100: (v: N) => (v == null ? '–' : `${Math.round(v)}%`),
  num: (v: N, digits = 1) => (v == null ? '–' : v.toFixed(digits)),
  int: (v: N) => (v == null ? '–' : Math.round(v).toLocaleString()),
}
