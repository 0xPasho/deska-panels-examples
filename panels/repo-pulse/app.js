/*
 * Repo Pulse: watch a few public GitHub repositories without signing in.
 * Stars, forks, open issues, the last push and the latest release, and a
 * notification when a watched repository publishes a new release.
 *
 * What this panel teaches:
 * - Living within a strict public rate limit: conditional requests with ETags
 *   kept in deska.storage, the X-RateLimit headers, backing off until the reset.
 * - Refreshing on a slow cadence and only while deska.visible says someone can see it.
 * - deska.notify on a real transition, deduplicated across reloads through deska.storage.
 * - deska.openUrl from a click, and images from a second declared network host.
 */
import { getJson, trimRepo, trimRelease, parseRepo, NotFound, Offline, OutOfRequests } from './github.js'

const SEED = ['microsoft/vscode', 'vercel/next.js', 'denoland/deno']
const MAX_REPOS = 12
const REQUESTS_PER_REPO = 2 // the repository, then its latest release
// Refreshes spend at most half of the 60 an hour, leaving room for adding
// repositories and for anything else on this network that calls GitHub.
const HOURLY_BUDGET = 30
const MIN_INTERVAL = 10 * 60_000
const HOUR = 60 * 60_000

const $ = (id) => document.getElementById(id)
const keyOf = (name) => name.toLowerCase()
const state = { repos: [], cache: {}, rate: null, refreshing: false, problem: null, flash: null, timer: 0, flashTimer: 0 }

// ---- the budget ---------------------------------------------------------------

/** 3 repositories refresh every 12 minutes, 12 of them every 48. */
const interval = () => Math.max(MIN_INTERVAL, (HOUR * REQUESTS_PER_REPO * state.repos.length) / HOURLY_BUDGET)

/** The last rate GitHub reported, or null once its hour has rolled over. */
const currentRate = () => (state.rate && state.rate.resetAt > Date.now() ? state.rate : null)
const requestsLeft = () => currentRate()?.remaining ?? state.rate?.limit ?? 60
const onRate = (rate) => (state.rate = rate)

function isStale(name) {
  const checkedAt = state.cache[keyOf(name)]?.checkedAt ?? 0
  return Date.now() - checkedAt >= interval()
}

// ---- saving -----------------------------------------------------------------------

async function save() {
  // deska.storage is the only storage that survives: the frame has an opaque
  // origin, so localStorage throws. The ETags live in the cache, which is how
  // the next request (even after a reload) can be conditional.
  try {
    await Promise.all([
      deska.storage.set('repos', state.repos),
      deska.storage.set('cache', state.cache),
      deska.storage.set('rate', state.rate),
    ])
  } catch (err) {
    flash(err.code === 'storage_full' ? 'Saved data is full, so changes will not last a reload.' : 'Could not save. Changes may not last a reload.')
  }
}

// ---- fetching -------------------------------------------------------------------

async function updateRepo(name, entry) {
  try {
    const repo = await getJson(`/repos/${name}`, entry.repoEtag, onRate)
    if (repo.changed) Object.assign(entry, { repo: trimRepo(repo.data), repoEtag: repo.etag })
    entry.missing = false
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
    entry.missing = true
  }
}

/** Returns the release when it is new since the last check, else null. */
async function updateRelease(name, entry) {
  const before = entry.release // undefined until the first check, null for no releases
  try {
    const release = await getJson(`/repos/${name}/releases/latest`, entry.releaseEtag, onRate)
    if (release.changed) Object.assign(entry, { release: trimRelease(release.data), releaseEtag: release.etag })
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
    entry.release = null // no releases yet; a 404 has no ETag to send next time
    entry.releaseEtag = null
  }
  // A transition, not a first sighting: the first check only learns what is there.
  const isNew = before !== undefined && entry.release && entry.release.tag !== before?.tag
  if (!isNew) return null
  entry.fresh = true
  return entry.release
}

async function refresh({ force = false } = {}) {
  if (state.refreshing) return
  const due = state.repos.filter((name) => force || isStale(name))
  if (!due.length) return schedule()
  state.refreshing = true
  state.problem = null
  render()
  const released = []
  try {
    for (const name of due) {
      if (requestsLeft() < REQUESTS_PER_REPO) throw new OutOfRequests(currentRate().resetAt)
      const entry = (state.cache[keyOf(name)] ??= {})
      await updateRepo(name, entry)
      if (!entry.missing) {
        const release = await updateRelease(name, entry)
        if (release) released.push({ name: entry.repo?.fullName ?? name, release })
      }
      entry.checkedAt = Date.now()
    }
  } catch (err) {
    state.problem = problemOf(err)
  } finally {
    state.refreshing = false
    // Saved before notifying: a reload from here on already knows these
    // releases, so nobody is told twice.
    await save()
    render()
    schedule()
  }
  if (released.length) announce(released)
}

function problemOf(err) {
  if (err instanceof OutOfRequests) {
    // Remember the wait in the saved rate so a reload backs off too.
    state.rate = { ...(state.rate ?? { limit: 60 }), remaining: 0, resetAt: err.resetAt }
    return { kind: 'limit', retryAt: err.resetAt + 5_000 }
  }
  if (err instanceof Offline) return { kind: 'offline', retryAt: Date.now() + 60_000 }
  return { kind: 'error', retryAt: Date.now() + 5 * 60_000 }
}

/** The next refresh, only while someone can see the panel. */
function schedule() {
  clearTimeout(state.timer)
  // deska.visible is false when the panel is scrolled away or folded in a
  // dock, deska.idle when the person stepped away. Neither needs fresh
  // numbers, and every request spends the hourly budget.
  if (!deska.visible || deska.idle || !state.repos.length) return
  const oldest = Math.min(...state.repos.map((name) => state.cache[keyOf(name)]?.checkedAt ?? 0))
  let at = Math.max(oldest + interval(), state.problem?.retryAt ?? 0)
  const rate = currentRate()
  if (rate && rate.remaining < REQUESTS_PER_REPO) at = Math.max(at, rate.resetAt + 5_000)
  state.timer = setTimeout(() => refresh(), Math.max(1_000, at - Date.now()))
}

// ---- notifying ----------------------------------------------------------------------

function noticeFor(released) {
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  if (released.length === 1) {
    const [{ name, release }] = released
    const body = release.name !== release.tag ? release.name : undefined
    return { title: clip(`${name} ${release.tag} is out`, 80), body: body && clip(body, 240) }
  }
  const list = released.map(({ name, release }) => `${name} ${release.tag}`).join(', ')
  return { title: `${released.length} new releases`, body: clip(list, 240) }
}

async function announce(released, retry = true) {
  const notice = noticeFor(released)
  try {
    // One notice per refresh, however many releases it found: notify allows
    // one every 10 seconds per panel.
    await deska.notify(notice)
  } catch (err) {
    // rate_limited: a notice went out moments ago, so wait out the 10 seconds once.
    if (err.code === 'rate_limited' && retry) setTimeout(() => announce(released, false), 10_000)
    // permission_denied: this copy may not notify. The rows still say New.
  }
}

// ---- adding, removing, opening ---------------------------------------------------------

async function addRepo(event) {
  event.preventDefault() // form-action is 'none' in a panel: never let a form submit
  const input = $('repo-input')
  const name = parseRepo(input.value)
  const watching = (n) => state.repos.find((r) => keyOf(r) === keyOf(n))
  if (!name) return hint('Type owner/name or paste a github.com link.')
  if (watching(name)) return hint(`Already watching ${watching(name)}.`)
  if (state.repos.length >= MAX_REPOS) return hint(`Up to ${MAX_REPOS} repositories, so refreshes fit the hourly limit.`)
  if (requestsLeft() < REQUESTS_PER_REPO) return hint(`Out of GitHub requests until ${clockTime(currentRate().resetAt)}.`)

  setAdding(true)
  try {
    const entry = {}
    await updateRepo(name, entry)
    if (entry.missing) return hint(`No public repository named ${name}.`)
    const fullName = entry.repo.fullName // GitHub's spelling, after any rename
    if (watching(fullName)) return hint(`Already watching ${fullName}.`)
    await updateRelease(fullName, entry)
    entry.checkedAt = Date.now()
    state.cache[keyOf(fullName)] = entry
    state.repos.push(fullName)
    input.value = ''
    hint('')
    await save()
    render()
  } catch (err) {
    if (err instanceof Offline) hint('You are offline. Try again once connected.')
    else if (err instanceof OutOfRequests) hint(`Out of GitHub requests until ${clockTime(err.resetAt)}.`)
    else hint('GitHub did not answer. Try again in a moment.')
  } finally {
    setAdding(false)
    renderFoot()
  }
}

async function removeRepo(name) {
  const index = state.repos.indexOf(name)
  state.repos = state.repos.filter((n) => n !== name)
  delete state.cache[keyOf(name)]
  render()
  // The person pressed Remove, so moving focus is theirs: the row that took
  // its place, or the input when the list is empty.
  const rows = $('list').querySelectorAll('.open')
  ;(rows[Math.min(index, rows.length - 1)] ?? $('repo-input')).focus()
  schedule()
  await save()
}

const OPEN_ERRORS = {
  not_focused: 'Click the panel, then open the link again.',
  rate_limited: 'One link a second. Try again.',
  permission_denied: 'This copy of the panel may not open links.',
  invalid_args: 'That link could not be opened.',
}

async function open(url, key) {
  try {
    // openUrl only works while the frame has focus, which is why it runs
    // straight from a click. Deska asks the person the first time per host.
    await deska.openUrl(url)
    const entry = key && state.cache[key]
    if (entry?.fresh) {
      entry.fresh = false
      render()
      await save()
    }
  } catch (err) {
    // declined: the person said no to opening it. Respect that quietly.
    if (err.code !== 'declined') flash(OPEN_ERRORS[err.code] ?? 'The link could not be opened.')
  }
}

// ---- rendering ----------------------------------------------------------------------------

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en')
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function ago(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const units = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]]
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return 'just now'
}

const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text // GitHub data is untrusted: text only, never HTML
  return node
}

const ICONS = {
  star: 'M8 1.75l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62z',
  fork: 'M5 2.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm6 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM8 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM5 5.25v.5c0 1 .75 1.75 1.75 1.75h2.5c1 0 1.75-.75 1.75-1.75v-.5M8 7.5v3.25',
  issue: 'M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5zM8 7.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z',
}

function stat(icon, value, noun) {
  const span = el('span', 'stat')
  span.title = `${full.format(value)} ${noun}`
  span.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`)
  span.append(el('span', '', compact.format(value)), el('span', 'sr-only', ` ${noun}`))
  return span
}

function avatarFor(repo) {
  const img = el('img', 'avatar')
  img.alt = ''
  img.width = img.height = 20
  if (!repo?.avatar) return img
  // A second declared host: avatars.githubusercontent.com is in panel.json's
  // network list, which is what lets the CSP's img-src load it.
  const src = new URL(repo.avatar)
  src.searchParams.set('s', '40')
  img.src = src.href
  img.addEventListener('error', () => img.removeAttribute('src'), { once: true })
  return img
}

function metaFor(entry) {
  const meta = el('p', 'meta')
  if (entry?.missing) {
    meta.textContent = 'Not found. It may be private, renamed or deleted.'
    return meta
  }
  if (!entry?.repo) {
    meta.textContent = state.refreshing ? 'Loading' : 'Waiting for GitHub'
    return meta
  }
  const { stars, forks, issues, pushedAt } = entry.repo
  const pushed = el('span', 'pushed')
  pushed.dataset.prefix = 'pushed '
  pushed.dataset.time = pushedAt
  meta.append(stat('star', stars, 'stars'), stat('fork', forks, 'forks'), stat('issue', issues, 'open issues and pull requests'), pushed)
  return meta
}

function releaseFor(entry, key, name) {
  if (!entry?.repo || entry.release === undefined) return null
  if (entry.release === null) return el('p', 'release none', 'No releases yet')
  const { tag, url, publishedAt } = entry.release
  const button = el('button', 'release')
  button.type = 'button'
  button.setAttribute('aria-label', `Open the ${tag} release of ${name}${entry.fresh ? ', new' : ''}`)
  const when = el('span', 'when')
  when.dataset.time = publishedAt
  button.append(el('span', 'tag', tag), when)
  if (entry.fresh) button.append(el('span', 'new', 'New'))
  button.addEventListener('click', () => open(url, key))
  return button
}

function rowFor(name) {
  const key = keyOf(name)
  const entry = state.cache[key]
  const display = entry?.repo?.fullName ?? name
  const [owner, repo] = display.split('/')
  const li = el('li', 'repo')

  const openButton = el('button', 'open')
  openButton.type = 'button'
  openButton.setAttribute('aria-label', `Open ${display} on GitHub`)
  openButton.append(el('span', 'owner', `${owner}/`), el('span', 'name', repo))
  openButton.addEventListener('click', () => open(entry?.repo?.url ?? `https://github.com/${name}`))

  const remove = el('button', 'remove')
  remove.type = 'button'
  remove.setAttribute('aria-label', `Stop watching ${display}`)
  remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7"/></svg>'
  remove.addEventListener('click', () => removeRepo(name))

  li.append(avatarFor(entry?.repo), openButton, remove, metaFor(entry))
  const release = releaseFor(entry, key, display)
  if (release) li.append(release)
  return li
}

/** Relative times change by the minute; only their text is redrawn. */
function renderTimes() {
  for (const node of document.querySelectorAll('[data-time]')) {
    node.textContent = `${node.dataset.prefix ?? ''}${ago(node.dataset.time)}`
  }
  const checked = Math.max(0, ...state.repos.map((n) => state.cache[keyOf(n)]?.checkedAt ?? 0))
  $('updated').textContent = state.refreshing ? 'Updating' : checked ? `Updated ${ago(new Date(checked))}` : ''
}

function renderFoot() {
  const rate = currentRate()
  const left = requestsLeft()
  // Quiet, but always there: the budget is the whole design of this panel.
  $('budget').textContent =
    rate && left < REQUESTS_PER_REPO
      ? `Out of requests until ${clockTime(rate.resetAt)}`
      : `${left} ${left === 1 ? 'request' : 'requests'} left this hour`
  $('refresh').disabled = state.refreshing || !state.repos.length || left < REQUESTS_PER_REPO
  renderTimes()
}

function problemText(problem) {
  if (problem.kind === 'limit') return `GitHub's hourly limit is used up. Next refresh at ${clockTime(problem.retryAt)}.`
  const saved = state.repos.some((n) => state.cache[keyOf(n)]?.repo)
  const then = saved ? 'Showing saved numbers.' : 'Numbers load once it answers.'
  if (problem.kind === 'offline') return `You are offline. ${saved ? then : 'Numbers load once connected.'}`
  return `GitHub did not answer. ${then}`
}

/** One line under the list: a lasting problem wins over a passing message. */
function renderNote() {
  // With nothing watched there is nothing to fetch, so no problem to report.
  const problem = state.repos.length ? state.problem : null
  const text = problem ? problemText(problem) : state.flash
  $('note-text').textContent = text ?? ''
  $('note').hidden = !text
  $('note-retry').hidden = !problem || problem.kind === 'limit'
}

function render() {
  $('list').replaceChildren(...state.repos.map(rowFor))
  $('list').hidden = !state.repos.length
  $('empty').hidden = state.repos.length > 0
  $('panel').setAttribute('aria-busy', String(state.refreshing && !state.repos.some((n) => state.cache[keyOf(n)]?.repo)))
  renderNote()
  renderFoot()
}

function hint(text) {
  $('add-hint').textContent = text
}

function flash(text) {
  clearTimeout(state.flashTimer)
  state.flash = text
  renderNote()
  state.flashTimer = setTimeout(() => {
    state.flash = null
    renderNote()
  }, 5_000)
}

function setAdding(busy) {
  $('add-button').disabled = busy
  $('add-button').textContent = busy ? 'Adding' : 'Add'
}

/** A theme change recolors everything at once: let it snap, not smear. */
function snapTheme() {
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.append(style)
  void document.body.offsetHeight
  requestAnimationFrame(() => style.remove())
}

// ---- start ----------------------------------------------------------------------------------

async function load(key) {
  try {
    return await deska.storage.get(key)
  } catch {
    return null // not_ready cannot happen after ready(); anything else starts clean
  }
}

async function start() {
  // ready() resolves with the init payload once Deska answers. The theme
  // tokens and deska.visible are already applied by then.
  await deska.ready()
  const [repos, cache, rate] = await Promise.all([load('repos'), load('cache'), load('rate')])
  const firstRun = !Array.isArray(repos)
  state.repos = firstRun ? [...SEED] : repos
  state.cache = cache && typeof cache === 'object' ? cache : {}
  state.rate = rate
  render()
  if (firstRun) await save()

  $('add').addEventListener('submit', addRepo)
  $('repo-input').addEventListener('input', () => hint(''))
  $('refresh').addEventListener('click', () => refresh({ force: true }))
  $('note-retry').addEventListener('click', () => {
    state.problem = null
    refresh()
  })
  window.addEventListener('online', () => state.problem?.kind === 'offline' && refresh())
  deska.on('theme', snapTheme)
  // Coming back into view catches up at once if a refresh came due meanwhile;
  // going out of view cancels the timer.
  deska.on('visibility', () => {
    schedule()
    if (deska.visible) renderFoot()
  })
  setInterval(() => deska.visible && renderFoot(), 30_000)
  schedule()
}

start()
