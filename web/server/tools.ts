// Tool schemas sent to Claude. The implementations live in the browser
// (src/ai/tools.ts) so they can reuse the app's scoring code and settings.
// Keep names and fields in sync with that file.

import type Anthropic from '@anthropic-ai/sdk'

export const SORT_KEYS = [
  'score', 'draw_odds', 'pts_for_50', 'success', 'draw_x_success', 'density',
  'mature', 'public', 'crowding', 'applicants', 'apps_per_tag',
] as const

const residency = { type: 'string', enum: ['R', 'NR'], description: 'R = resident, NR = nonresident. Omit to use the table setting.' }
const points = { type: 'integer', minimum: 0, maximum: 40, description: 'Bonus/preference points the hunter has. Omit to use the table setting.' }

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'describe_data',
    description:
      'Lists what is loaded: species, tag types per species (with draw/general counts), data coverage and gaps, and the ' +
      "user's current table settings (residency, points, years averaged, score weights, species shown). Call this first " +
      'when unsure which species or tag-type names exist.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_hunts',
    description:
      'Filters, sorts and ranks hunts for one species using the same scoring as the table. Returns matching rows with ' +
      'hunt_id, unit, tag type, draw/general, score and rank, draw odds at the given points, points needed for 50% odds, ' +
      'harvest success, mature-male %, elk density, public land %, hunters per sq mi, applicants, and caveat flags. ' +
      'Also returns total_matches so you know if the list was cut off.',
    input_schema: {
      type: 'object',
      properties: {
        species: { type: 'string', description: 'e.g. "elk", "mule deer", "whitetail deer", "pronghorn", "moose", "bighorn sheep", "mountain goat"' },
        tag_types: { type: 'array', items: { type: 'string' }, description: 'Exact tag type names from describe_data, e.g. ["Elk permit"]. Omit for all.' },
        access: { type: 'string', enum: ['all', 'draw', 'general'], description: 'Drawn tags, general (over-the-counter) hunts, or both. Default all.' },
        units: { type: 'array', items: { type: 'string' }, description: 'Hunting district numbers, e.g. ["215", "410"].' },
        residency,
        points,
        min_draw_odds_pct: { type: 'number', minimum: 0, maximum: 100 },
        max_points_for_50: { type: 'integer', minimum: 0, description: 'Only hunts reaching 50% odds within this many points.' },
        min_success_pct: { type: 'number', minimum: 0, maximum: 100 },
        min_mature_pct: { type: 'number', minimum: 0, maximum: 100, description: 'Elk: % of harvested bulls 6+ pts. Deer: % of bucks 4+ pts.' },
        min_public_pct: { type: 'number', minimum: 0, maximum: 100 },
        min_density: { type: 'number', minimum: 0, description: 'Animals per sq mi (elk only for now).' },
        max_hunters_per_sq_mi: { type: 'number', minimum: 0 },
        exclude_permit_districts: { type: 'boolean', description: 'Drop general hunts flagged as sharing a district with a draw permit.' },
        sort_by: { type: 'string', enum: [...SORT_KEYS], description: 'Default score.' },
        sort_dir: { type: 'string', enum: ['asc', 'desc'], description: 'Default: best first for the chosen column.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Rows to return, default 15.' },
      },
      required: ['species'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_hunt',
    description:
      'Full detail for one hunt: score breakdown by factor, draw results by point level for the latest year (observed ' +
      'and modeled odds), odds at each point level 0-30, harvest by year, herd count and goal status, district land ' +
      'ownership, and notes/caveats.',
    input_schema: {
      type: 'object',
      properties: {
        hunt_id: { type: 'string', description: 'hunt_id from search_hunts, e.g. "MT-ELK PERMIT 410-20".' },
        residency,
        points,
      },
      required: ['hunt_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_in_table',
    description:
      "Changes the user's table view: species, tag types, draw/general, search text, filters and sort, and optionally " +
      'opens one hunt\'s detail panel. Use when the user asks to "show", "filter" or "open" something, or when a result ' +
      'set is easier to browse in the table. It does not change residency, points or weights.',
    input_schema: {
      type: 'object',
      properties: {
        species: { type: 'string' },
        tag_types: { type: 'array', items: { type: 'string' } },
        access: { type: 'string', enum: ['all', 'draw', 'general'] },
        search: { type: 'string', description: 'Unit number, hunt code or district name text.' },
        min_draw_odds_pct: { type: 'number', minimum: 0, maximum: 100 },
        min_success_pct: { type: 'number', minimum: 0, maximum: 100 },
        min_public_pct: { type: 'number', minimum: 0, maximum: 100 },
        max_points_for_50: { type: 'integer', minimum: 0 },
        sort_by: { type: 'string', enum: [...SORT_KEYS] },
        sort_dir: { type: 'string', enum: ['asc', 'desc'] },
        open_hunt_id: { type: 'string', description: 'Open this hunt in the detail panel.' },
      },
      required: ['species'],
      additionalProperties: false,
    },
  },
]
