// The only file that talks to api.github.com. Every request is conditional
// (If-None-Match with the ETag we saved last time) and reports the rate limit
// headers GitHub sends back, so the panel always knows its budget.

const API = 'https://api.github.com'

export class NotFound extends Error {}
export class Offline extends Error {}
export class OutOfRequests extends Error {
  constructor(resetAt) {
    super('out_of_requests')
    this.resetAt = resetAt
  }
}

/** Reads X-RateLimit-* into { limit, remaining, resetAt } (resetAt in ms). */
export function readRate(headers) {
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (remaining === null || !reset) return null
  return { limit: Number(headers.get('x-ratelimit-limit')) || 60, remaining: Number(remaining), resetAt: reset * 1000 }
}

/**
 * A conditional GET. Resolves { changed: false } on 304, so the caller keeps
 * what it already has, or { changed: true, data, etag } on 200.
 * onRate receives the rate limit after every answer, errors included.
 */
export async function getJson(path, etag, onRate) {
  const headers = { Accept: 'application/vnd.github+json' }
  if (etag) headers['If-None-Match'] = etag
  let res
  try {
    // no-store: with our own If-None-Match the browser hands the 304 to us
    // instead of answering from its HTTP cache, so we see every answer.
    res = await fetch(`${API}${path}`, { headers, cache: 'no-store' })
  } catch {
    throw new Offline()
  }
  const rate = readRate(res.headers)
  if (rate) onRate(rate)
  if (res.status === 304) return { changed: false }
  if (res.status === 404) throw new NotFound()
  if (res.status === 403 || res.status === 429) {
    // The primary limit says remaining 0; a secondary limit sends Retry-After.
    const retryAfter = Number(res.headers.get('retry-after'))
    if (retryAfter) throw new OutOfRequests(Date.now() + retryAfter * 1000)
    if (rate && rate.remaining === 0) throw new OutOfRequests(rate.resetAt)
  }
  if (!res.ok) throw new Error(`github_${res.status}`)
  return { changed: true, data: await res.json(), etag: res.headers.get('etag') }
}

/** Keeps only what the panel shows, so the saved cache stays small. */
export function trimRepo(r) {
  return {
    fullName: r.full_name,
    url: r.html_url,
    avatar: r.owner?.avatar_url ?? null,
    stars: r.stargazers_count,
    forks: r.forks_count,
    issues: r.open_issues_count,
    pushedAt: r.pushed_at,
  }
}

export function trimRelease(r) {
  return { tag: r.tag_name, name: r.name || r.tag_name, url: r.html_url, publishedAt: r.published_at || r.created_at }
}

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})'
const NAME = '[A-Za-z0-9._-]{1,100}'
const PLAIN = new RegExp(`^(${OWNER})/(${NAME})$`)
const LINK = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${NAME})(?:[/?#].*)?$`, 'i')

/** "owner/name" or a github.com link to "owner/name"; null when neither. */
export function parseRepo(input) {
  const text = input.trim()
  const match = text.match(PLAIN) || text.match(LINK)
  if (!match) return null
  const name = match[2].replace(/\.git$/i, '')
  if (!name || name === '.' || name === '..') return null
  return `${match[1]}/${name}`
}
