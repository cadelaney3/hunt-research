import { useEffect, useState } from 'react'
import { fmt } from './format'
import LineChart from './LineChart'
import { drawOdds, FACTORS, lotteryModel, pointsFor, successOf, type FactorKey, type Ranked, type Settings, type Weights } from './scoring'

interface Props {
  row: Ranked
  settings: Settings
  weights: Weights
  available: FactorKey[]
  onClose: () => void
}

const STATUS_LABEL = { at: 'At goal', above: 'Above goal', below: 'Below goal' } as const

const DRAW_SYSTEM_NOTE = {
  general: 'General license: no draw.',
  bonus: 'Bonus-point lottery: each applicant gets points² + 1 chances, so more points help but nothing is guaranteed. Odds are modeled from the whole pool, since per-level counts are small.',
  preference: 'Preference-point draw: tags go to the highest point levels first.',
  random: 'Random draw: points don’t affect odds.',
}

export default function HuntDetail({ row, settings, weights, available, onClose }: Props) {
  const { hunt, m, factors, score, rank } = row
  const res = settings.residency
  const yearsWithDraw = hunt.years.filter((y) => y.draw[res]?.length)
  const [drawYear, setDrawYear] = useState<number | null>(null)
  const shownDraw = yearsWithDraw.find((y) => y.year === drawYear) ?? yearsWithDraw.at(-1)

  useEffect(() => setDrawYear(null), [hunt.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shownFactors = FACTORS.filter((f) => available.includes(f.key))
  const totalWeight = shownFactors.reduce((a, f) => a + weights[f.key], 0)
  const general = hunt.draw_system === 'general'
  const lottery = hunt.draw_system === 'bonus' || hunt.draw_system === 'random'
  const rawValue: Record<FactorKey, string> = {
    draw: hunt.draw_system === 'general' ? '100% (general license, no draw)' : `${fmt.odds(m.drawOdds)} at ${settings.points} pts`,
    success: fmt.pct(m.success),
    population: `${fmt.num(m.density, 1)}/sq mi${m.popTrend != null ? `, ${m.popTrend >= 0 ? '+' : ''}${Math.round(m.popTrend * 100)}%` : ''}`,
    quality: [m.matureMales != null && `${Math.round(m.matureMales)}% mature`, m.avgAge != null && `age ${m.avgAge.toFixed(1)}`,
      m.malesPer100 != null && `${Math.round(m.malesPer100)}:100`, m.rating != null && `rated ${m.rating.toFixed(1)}`]
      .filter(Boolean).join(', ') || '–',
    crowding: `${fmt.num(m.huntersPerSqMi, 2)} hunters/sq mi`,
    publicLand: fmt.pct100(m.publicLand),
  }

  const series = (f: (y: (typeof hunt.years)[number]) => number | null | undefined) =>
    hunt.years.map((y) => ({ x: y.year, y: f(y) ?? null }))
  // Survey metrics skip years with no estimate (e.g. hunters counted every other year) instead of breaking the line.
  const surveySeries = (f: (y: (typeof hunt.years)[number]) => number | null | undefined) =>
    series(f).filter((d) => d.y != null)
  const harvestYears = hunt.years.filter((y) => y.harvest != null)
  const herdYearRow = [...hunt.years].reverse().find((y) => y.herd_info?.length)
  const herds = herdYearRow?.herd_info ?? []
  const herdYear = herdYearRow?.year
  const maleQuality = hunt.sex !== 'female'
  const trends: [string, ReturnType<typeof series>, (v: number) => string, string?][] = [
    ['Your draw odds', series((y) => drawOdds(y.draw[res] ?? [], settings.points, hunt.draw_system)), (v) => fmt.pct(v), `${res}, ${settings.points} pts`],
    ['Points for 50% odds', series((y) => pointsFor(y.draw[res] ?? [], hunt.draw_system)), (v) => v.toFixed(0), 'lower is easier'],
    ['Applicants per tag', series((y) => {
      const apps = (y.draw[res] ?? []).reduce((a, l) => a + l.applicants, 0)
      const drawn = (y.draw[res] ?? []).reduce((a, l) => a + l.drawn, 0)
      return drawn ? apps / drawn : null
    }), (v) => v.toFixed(1), res],
    ['Harvest success', surveySeries(successOf), (v) => fmt.pct(v), harvestYears.some((y) => y.harvest_source === 'district') ? 'district, all hunters' : undefined],
    ['Total harvest', surveySeries((y) => y.harvest), (v) => v.toFixed(0)],
    ['Animals per sq mi', series((y) => y.pop_density), (v) => v.toFixed(1)],
    ['Males per 100 females', series((y) => y.males_per_100_females), (v) => v.toFixed(0)],
    ['% mature males', maleQuality ? surveySeries((y) => y.pct_mature_males) : [], (v) => `${v.toFixed(0)}%`, matureLabel(hunt.species)],
    ['Hunters', surveySeries((y) => y.hunters), (v) => v.toFixed(0)],
  ]
  const trendCharts = trends
    .filter(([, data]) => data.filter((d) => d.y != null).length >= 2)
    .map(([title, data, format, note]) => <LineChart key={title} title={title} data={data} format={format} note={note} />)

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={`Details for ${hunt.hunt_code}`}>
        <header className="drawer-head">
          <div>
            <div className="muted small">{hunt.state} · {hunt.species} · {hunt.hunt_code}</div>
            <h2>
              {hunt.units.length > 1 ? 'Units' : 'Unit'} {hunt.units.join(', ')} — {hunt.season ?? hunt.license}
            </h2>
            <div className="muted small">
              {[hunt.season && hunt.license, hunt.weapon !== 'any' && hunt.weapon, hunt.sex, hunt.notes,
                hunt.area_sq_mi && `${Math.round(hunt.area_sq_mi)} sq mi`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {general && hunt.permit_overlap?.length ? (
          <div className="notice">
            ⚠ This district also has draw permits ({hunt.permit_overlap.map((c) => c.replace(/^.*?(?=\d{3}-\d{2})/, '')).join(', ')}).
            The general license may not be valid for the animals those permits cover (often bulls/bucks), and the
            district harvest and quality numbers below include permit holders. Check the regulations before
            comparing it with the permit.
          </div>
        ) : null}

        <section className="tiles">
          <Tile label="Score" value={score == null ? '–' : String(Math.round(score))} sub={`Rank #${rank}`} />
          {general ? (
            <>
              <Tile label="Draw" value="None" sub="general license" />
              <Tile label="Hunters" value={fmt.int([...hunt.years].reverse().find((y) => y.hunters != null)?.hunters)} sub="latest estimate, district" />
            </>
          ) : (
            <>
              <Tile label="Your draw odds" value={fmt.odds(m.drawOdds)} sub={`${res}, ${settings.points} pts`} />
              <Tile label="Pts for 50% odds" value={m.ptsFor50 === Infinity ? '40+' : fmt.int(m.ptsFor50)} sub={hunt.draw_system === 'bonus' ? 'bonus-point lottery' : undefined} />
            </>
          )}
          {m.success != null
            ? <Tile label="Success" value={fmt.pct(m.success)} sub={`draw × success ${fmt.pct(m.harvestChance, 1)}`} />
            : <Tile label="Applicants / tag" value={fmt.num(m.appsPerTag, 1)} sub={`${fmt.int(m.applicants)} ${res} 1st choice`} />}
        </section>

        <section>
          <h3>Score breakdown</h3>
          <table className="breakdown">
            <thead>
              <tr><th>Factor</th><th>Value</th><th>Rating</th><th>Weight</th><th>Points</th></tr>
            </thead>
            <tbody>
              {shownFactors.map((f) => {
                const v = factors[f.key]
                const share = !totalWeight ? 0 : weights[f.key] / totalWeight
                return (
                  <tr key={f.key} title={f.help} className={v == null ? 'na' : ''}>
                    <td>{f.label}</td>
                    <td className="small">{rawValue[f.key]}</td>
                    <td>
                      {v == null ? <span className="muted small">no data → 50</span> : (
                        <span className="score"><span className="num">{Math.round(v * 100)}</span>
                          <span className="meter"><span style={{ width: `${v * 100}%` }} /></span></span>
                      )}
                    </td>
                    <td className="num">{Math.round(share * 100)}%</td>
                    <td className="num strong">{((v ?? 0.5) * share * 100).toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">
            Ratings are percentiles among all {hunt.species} hunts in scope (draw odds and public land are absolute).
            A factor this hunt has no data for counts as average (50).
            {shownFactors.length < FACTORS.length &&
              ` Not scored yet (no data loaded): ${FACTORS.filter((f) => !available.includes(f.key)).map((f) => f.label.toLowerCase()).join(', ')}.`}
          </p>
        </section>

        {shownDraw && (
          <section>
            <h3>Odds by points</h3>
            <p className="muted small">{DRAW_SYSTEM_NOTE[hunt.draw_system]}</p>
            <div className="charts one">
              <LineChart
                title={`${shownDraw.year} first-choice odds, ${res === 'R' ? 'resident' : 'nonresident'}`}
                note={lottery ? 'modeled' : 'observed'}
                data={Array.from({ length: Math.max(maxPoints(shownDraw.draw[res]), settings.points) + 3 }, (_, p) => ({
                  x: p,
                  y: drawOdds(shownDraw.draw[res], p, hunt.draw_system),
                }))}
                format={(v) => fmt.pct(v)}
                xFormat={(x) => `${x} pts`}
                markX={settings.points}
                wide
              />
            </div>
          </section>
        )}

        {trendCharts.length > 0 ? (
          <section>
            <h3>Trends</h3>
            <div className="charts">{trendCharts}</div>
          </section>
        ) : (
          <p className="muted small">Year-over-year trends appear once a second year of data is loaded.</p>
        )}

        {shownDraw && (
          <section>
            <div className="section-head">
              <h3>Draw by point level</h3>
              <select value={shownDraw.year} onChange={(e) => setDrawYear(Number(e.target.value))}>
                {yearsWithDraw.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
              </select>
            </div>
            <table className="levels">
              <thead><tr><th>Points</th><th>Applicants</th><th>Drawn</th><th>Observed</th>{lottery && <th>Modeled</th>}</tr></thead>
              <tbody>
                {[...shownDraw.draw[res]].reverse().map((l) => (
                  <tr key={l.points} className={l.points === settings.points ? 'mine' : ''}>
                    <td>{l.points}{l.points === settings.points && <span className="badge">you</span>}</td>
                    <td className="num">{l.applicants.toLocaleString()}</td>
                    <td className="num">{l.drawn.toLocaleString()}</td>
                    <td className="num">
                      <span className="score"><span className="num">{fmt.pct(l.applicants ? l.drawn / l.applicants : null)}</span>
                        <span className="meter"><span style={{ width: `${l.applicants ? (l.drawn / l.applicants) * 100 : 0}%` }} /></span></span>
                    </td>
                    {lottery && <td className="num">{fmt.pct(lotteryModel(shownDraw.draw[res], hunt.draw_system)(l.points), 1)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              First-choice applicants only; landowner-preference pool not shown.
              {shownDraw.quota != null ? ` Quota: ${shownDraw.quota.toLocaleString()} tags (all pools).` : hunt.notes?.includes('Unlimited') ? ' Unlimited quota.' : ''}
              {lottery && ' Observed rates at levels with only a handful of applicants are mostly luck; the modeled column is the better guide.'}
            </p>
          </section>
        )}

        {harvestYears.length > 0 && (
          <section>
            <h3>Harvest by year</h3>
            <table className="levels">
              <thead>
                <tr>
                  <th>Year</th><th>Hunters</th><th>Harvest</th><th>Success</th>
                  <th>{maleLabel(hunt.species)}</th>{maleQuality && <th>Mature</th>}<th>Bow</th>
                </tr>
              </thead>
              <tbody>
                {[...harvestYears].reverse().map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="num" title={y.hunters == null ? 'Not estimated this year' : undefined}>{y.hunters == null ? <span className="muted">n/e</span> : fmt.int(y.hunters)}</td>
                    <td className="num">{fmt.int(y.harvest)}</td>
                    <td className="num">{fmt.pct(successOf(y))}</td>
                    <td className="num">{fmt.int(y.males)}</td>
                    {maleQuality && <td className="num" title={y.classified_males ? `${y.mature_males} of ${y.classified_males}` : undefined}>{fmt.pct100(y.pct_mature_males)}</td>}
                    <td className="num">{fmt.int(y.bow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              {harvestYears.some((y) => y.harvest_source === 'district') && (
                <>FWP harvest estimates for district{harvestYears[0].harvest_units!.length > 1 ? 's' : ''} {harvestYears[0].harvest_units!.join(' + ')}, all hunters
                  combined (general tags too), not just this tag's holders. </>
              )}
              n/e = hunters not estimated that year (FWP surveys hunter numbers every other year).
              {maleQuality && matureLabel(hunt.species) && ` Mature = ${matureLabel(hunt.species)} share of harvested males with an antler class.`}
            </p>
          </section>
        )}

        <section>
          <h3>Unit info</h3>
          {hunt.unit_info.map((u) => (
            <div key={u.unit} className="unit-card">
              <div className="strong">{u.name ?? `Unit ${u.unit}`}</div>
              <div className="muted small">
                {[u.area_sq_mi && `${Math.round(u.area_sq_mi)} sq mi`, u.public_land_pct != null && `${Math.round(u.public_land_pct)}% public`]
                  .filter(Boolean).join(' · ') || 'No unit details'}
              </div>
              {u.notes && <p>{u.notes}</p>}
            </div>
          ))}
          {herds.map((hd) => (
            <div key={hd.herd} className="unit-card">
              <div className="strong">
                Herd: {hd.herd}
                {hd.status && <span className={`badge status-${hd.status}`}>{STATUS_LABEL[hd.status]}</span>}
              </div>
              <div className="muted small">
                {[
                  hd.population != null && `${hd.population.toLocaleString()} elk (3-yr avg count${herdYear ? `, ${herdYear} report` : ''})`,
                  hd.latest_count != null && `${hd.latest_count.toLocaleString()} counted in ${hd.latest_count_year}`,
                  hd.objective_low != null && `goal ${hd.objective_low.toLocaleString()}–${hd.objective_high!.toLocaleString()}`,
                  hd.population != null && hd.area_sq_mi && `${(hd.population / hd.area_sq_mi).toFixed(1)} per sq mi over ${Math.round(hd.area_sq_mi).toLocaleString()} sq mi`,
                ].filter(Boolean).join(' · ')}
              </div>
              {hd.notes && <div className="muted small">{hd.notes}</div>}
            </div>
          ))}
          {herds.length > 0 && (
            <p className="muted small">
              Winter aerial counts of observed elk, not total population; FWP compares the average to its goal range.
              Above goal usually means more liberal seasons and antlerless tags.
            </p>
          )}
          {hunt.notes && <p>{hunt.notes}</p>}
          {hunt.quality_notes.length > 0 && (
            <>
              <h4>Your notes</h4>
              <ul>{hunt.quality_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>
          )}
        </section>
      </aside>
    </>
  )
}

function matureLabel(species: string) {
  return species === 'elk' ? '6+ pt bulls' : species.endsWith('deer') ? '4+ pt bucks' : undefined
}

function maleLabel(species: string) {
  return ({ elk: 'Bulls', moose: 'Bulls', 'bighorn sheep': 'Rams', 'mountain goat': 'Billies' } as Record<string, string>)[species]
    ?? 'Bucks'
}

function maxPoints(levels: { points: number; applicants: number }[]) {
  return levels.reduce((a, l) => (l.applicants ? Math.max(a, l.points) : a), 0)
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="muted small">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}
