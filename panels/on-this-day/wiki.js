// Wikipedia's daily feeds, fetched and trimmed to what the panel shows.

import { baseLanguage } from './i18n.js'
//
// Every host here is also listed under "network" in panel.json. Deska turns
// that list into the page's Content Security Policy, and the policy takes
// exact host names only (no wildcards), so "*.wikipedia.org" is not an
// option: each language is one more host the person can read before they
// install. A language missing from panel.json would fail with a CSP error.

export const HOSTS = {
  en: 'en.wikipedia.org',
  es: 'es.wikipedia.org',
  fr: 'fr.wikipedia.org',
  de: 'de.wikipedia.org',
  pt: 'pt.wikipedia.org',
  it: 'it.wikipedia.org',
}
export const LANGUAGES = Object.keys(HOSTS)

/** The Wikipedia for a locale, or English when the panel has no host for it. */
export function wikiLanguageFor(locale) {
  const base = baseLanguage(locale)
  return HOSTS[base] ? base : 'en'
}

export const homeUrl = (lang) => `https://${HOSTS[lang]}/`

const pad = (n) => String(n).padStart(2, '0')

/** The local calendar day as "YYYY-MM-DD": the cache key and the refetch trigger. */
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

class FeedError extends Error {
  constructor(status) {
    super(`Wikipedia answered ${status}`)
    this.status = status
  }
}

// The opaque-origin frame can read these responses because Wikipedia's REST
// API answers every origin with Access-Control-Allow-Origin: *.
async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new FeedError(res.status)
  return res.json()
}

// Only https thumbnails on the two image hosts panel.json declares; anything
// else would be blocked by img-src anyway, so it is dropped here instead.
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org'])
function imageUrl(thumbnail) {
  if (!thumbnail?.source) return null
  try {
    const url = new URL(thumbnail.source)
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.host) ? url.href : null
  } catch {
    return null
  }
}

const pageUrl = (page) => page?.content_urls?.desktop?.page ?? null
const isYearPage = (page) => /^-?\d+$/.test(page?.titles?.normalized ?? '')

function trimEvent(event) {
  // The first linked article that is not just the year page ("1999").
  const page = event.pages?.find((p) => !isYearPage(p) && pageUrl(p)) ?? event.pages?.[0]
  return {
    year: event.year,
    text: event.text,
    title: page?.titles?.normalized ?? null,
    url: pageUrl(page),
    thumb: imageUrl(page?.thumbnail),
  }
}

function trimArticle(tfa) {
  if (!tfa) return null
  return {
    title: tfa.titles?.normalized ?? tfa.title,
    description: tfa.description ?? '',
    extract: tfa.extract ?? '',
    url: pageUrl(tfa),
    thumb: imageUrl(tfa.thumbnail),
  }
}

function trimPicture(image) {
  if (!image) return null
  const thumb = imageUrl(image.thumbnail)
  if (!thumb) return null
  return {
    thumb,
    width: image.thumbnail.width,
    height: image.thumbnail.height,
    description: image.description?.text ?? '',
    artist: image.artist?.text ?? '',
    license: image.license?.type ?? '',
    url: image.file_page ?? null,
  }
}

/**
 * Fetches one day for one language: the full list of events, plus the
 * featured feed for the article and the picture. Only the trimmed result is
 * kept, which keeps the cached copy far below the 256 KB storage budget.
 */
export async function fetchDay(lang, date, signal) {
  const host = HOSTS[lang]
  const [y, m, d] = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())]
  const [onThisDay, featured] = await Promise.all([
    getJson(`https://${host}/api/rest_v1/feed/onthisday/events/${m}/${d}`, signal),
    getJson(`https://${host}/api/rest_v1/feed/featured/${y}/${m}/${d}`, signal),
  ])
  return {
    lang,
    day: dayKey(date),
    fetchedAt: Date.now(),
    events: (onThisDay.events ?? []).map(trimEvent).sort((a, b) => b.year - a.year),
    article: trimArticle(featured.tfa),
    picture: trimPicture(featured.image),
  }
}
