// SomaFM's public API. Every endpoint here answers Access-Control-Allow-Origin: *,
// which is the only way a fetch from the panel's opaque origin can read it.

const API = 'https://api.somafm.com'

// The stream hosts declared in panel.json. A playlist may name others one
// day; Deska's media-src would block them, so they are skipped.
export const STREAM_HOSTS = ['ice1', 'ice2', 'ice3', 'ice4', 'ice5', 'ice6'].map((h) => `${h}.somafm.com`)

const text = (v) => (typeof v === 'string' ? v.trim() : '')

/** The station list, busiest first. */
export async function loadStations() {
  const res = await fetch(`${API}/channels.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`channels ${res.status}`)
  const { channels } = await res.json()
  return (Array.isArray(channels) ? channels : [])
    .filter((c) => c && /^[a-z0-9]+$/i.test(c.id))
    .map((c) => ({
      id: c.id,
      title: text(c.title) || c.id,
      genre: text(c.genre).split('|').join(', '),
      description: text(c.description),
      image: safeImage(c.image),
      listeners: Number(c.listeners) || 0,
      playlist: (c.playlists || []).find((p) => p.format === 'mp3')?.url || '',
    }))
    .sort((a, b) => b.listeners - a.listeners)
}

function safeImage(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.host === 'api.somafm.com' ? u.href : ''
  } catch {
    return ''
  }
}

/**
 * MP3 stream URLs for a station, in SomaFM's order. The .pls playlist lists
 * the current mirrors; if it cannot be read, fall back to the 128k pattern
 * every station serves.
 */
export async function streamCandidates(station) {
  const fallback = ['ice2', 'ice6', 'ice5'].map((h) => `https://${h}.somafm.com/${station.id}-128-mp3`)
  if (!station.playlist?.startsWith(`${API}/`)) return fallback
  try {
    const res = await fetch(station.playlist)
    const pls = res.ok ? await res.text() : ''
    const urls = [...pls.matchAll(/^File\d+=(.+)$/gm)].map((m) => m[1].trim()).filter(isStreamUrl)
    return urls.length ? urls : fallback
  } catch {
    return fallback
  }
}

function isStreamUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && STREAM_HOSTS.includes(url.host)
  } catch {
    return false
  }
}

/** "Title by Artist" for the song on air, or null when SomaFM does not say. */
export async function latestTrack(id) {
  try {
    const res = await fetch(`${API}/songs/${id}.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const song = (await res.json()).songs?.[0]
    if (!song) return null
    return [text(song.title), text(song.artist)].filter(Boolean).join(' by ') || null
  } catch {
    return null
  }
}
