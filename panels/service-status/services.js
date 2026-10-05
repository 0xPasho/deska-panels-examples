// The services this panel can watch and how to read one Atlassian Statuspage.
// Every host here is listed in panel.json `network`: the panel's CSP only
// lets fetch reach https hosts the package declares, and each of these
// answers `Access-Control-Allow-Origin: *`, which an opaque-origin frame needs.

export const SERVICES = [
  { id: 'anthropic', name: 'Anthropic', host: 'status.claude.com' },
  { id: 'openai', name: 'OpenAI', host: 'status.openai.com' },
  { id: 'github', name: 'GitHub', host: 'www.githubstatus.com' },
  { id: 'cursor', name: 'Cursor', host: 'status.cursor.com' },
  { id: 'vercel', name: 'Vercel', host: 'www.vercel-status.com' },
  { id: 'cloudflare', name: 'Cloudflare', host: 'www.cloudflarestatus.com' },
  { id: 'npm', name: 'npm', host: 'status.npmjs.org' },
]

const TIMEOUT_MS = 10_000

// Statuspage's overall indicator, in the words a person reads. Statuspage
// itself calls `major` a partial system outage and `critical` a major one.
export const LEVELS = {
  none: { word: 'Operational', tone: 'ok' },
  minor: { word: 'Degraded', tone: 'degraded' },
  major: { word: 'Partial outage', tone: 'down' },
  critical: { word: 'Major outage', tone: 'down' },
  maintenance: { word: 'Maintenance', tone: 'maintenance' },
}

const IMPACT_RANK = { critical: 3, major: 2, minor: 1, none: 0, maintenance: 0 }

/** Fetches one service. Never throws: a failure comes back as `{ error }`. */
export async function checkService(service) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // `no-cache` revalidates with the ETag the pages send, so an unchanged
    // summary costs the status page almost nothing.
    const res = await fetch(`https://${service.host}/api/v2/summary.json`, { cache: 'no-cache', signal: controller.signal })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return readSummary(await res.json(), service)
  } catch (err) {
    // A CSP refusal, a CORS failure and a dropped connection all land here as
    // a TypeError; a timeout is an AbortError.
    return { error: err?.name === 'AbortError' ? 'Timed out' : 'Unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/** Keeps only what the panel shows, so the cached snapshot stays small. */
function readSummary(summary, service) {
  const indicator = LEVELS[summary?.status?.indicator] ? summary.status.indicator : 'none'
  const incidents = Array.isArray(summary?.incidents) ? summary.incidents : []
  const worst = incidents
    .filter((i) => i && typeof i.name === 'string')
    .sort((a, b) => (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) || Date.parse(b.started_at || b.created_at) - Date.parse(a.started_at || a.created_at))[0]
  const maintenance = (Array.isArray(summary?.scheduled_maintenances) ? summary.scheduled_maintenances : []).find((m) => m?.status === 'in_progress')
  const active = worst || (indicator === 'maintenance' ? maintenance : null)
  return {
    indicator,
    incident: active ? { name: String(active.name).slice(0, 200), startedAt: Date.parse(active.started_at || active.created_at) || null, count: worst ? incidents.length : 1 } : null,
    url: pageUrl(summary?.page?.url, service.host),
  }
}

// Only ever open the service's own status host, whatever the payload says.
function pageUrl(url, host) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && parsed.host === host) return parsed.href
  } catch {}
  return `https://${host}/`
}

/** True when a result counts as a problem worth a notification. */
export const isIncident = (result) => !result.error && (result.indicator === 'minor' || result.indicator === 'major' || result.indicator === 'critical')
