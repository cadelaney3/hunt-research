// Shape of public/data/hunts.json (written by `python -m ingest build`).

export type Residency = 'R' | 'NR'
export type DrawSystem = 'preference' | 'bonus' | 'random' | 'general' // general = no draw

export interface DrawLevel {
  points: number
  applicants: number
  drawn: number
}

export interface HuntYear {
  year: number
  quota: number | null
  draw: Record<Residency, DrawLevel[]>
  hunters: number | null
  harvest: number | null
  days: number | null
  harvest_source?: 'hunt' | 'district' | null
  harvest_units?: string[]
  males?: number | null
  females?: number | null
  bow?: number | null
  rifle?: number | null
  mature_males?: number | null
  classified_males?: number | null
  pop_density: number | null
  males_per_100_females: number | null
  herds: string[]
  herd_info?: HerdInfo[]
  pct_mature_males: number | null
  avg_age: number | null
  rating: number | null
}

export interface UnitInfo {
  unit: string
  name: string | null
  area_sq_mi: number | null
  public_land_pct: number | null
  notes: string | null
}

export interface Hunt {
  id: string
  state: string
  species: string
  hunt_code: string
  license: string
  draw_system: DrawSystem
  units: string[]
  weapon: string | null
  season: string | null
  sex: string | null
  notes: string | null
  area_sq_mi: number | null
  public_land_pct: number | null
  unit_info: UnitInfo[]
  /** General hunts only: draw permits for the same species in this district. */
  permit_overlap?: string[]
  quality_notes: string[]
  years: HuntYear[]
}

export interface Dataset {
  generated_at: string
  source: string
  hunts: Hunt[]
  warnings: string[]
}

export interface HerdInfo {
  herd: string
  units: string[]
  population: number | null
  area_sq_mi: number | null
  latest_count: number | null
  latest_count_year: number | null
  objective_low: number | null
  objective_high: number | null
  status: 'at' | 'above' | 'below' | null
  notes: string | null
}
