/* HN Front Page: reads Hacker News through its official Firebase API and
 * lists the first 30 stories of Top, New, Best, Show or Ask. The title opens
 * the article, the comment count opens the discussion on Hacker News.
 *
 * What this panel teaches:
 * - fetch under the panel's CSP: the host is declared in panel.json `network`,
 *   every request has a timeout (AbortController), and offline, failed and
 *   partial loads each get their own state.
 * - deska.openUrl and its consent model: called straight from the click,
 *   `declined` handled quietly, `not_focused` explained.
 * - deska.storage for small UI memory: the chosen tab and the stories opened.
 * - deska.on('visibility') to refresh when the panel comes back after a while.
 */

const API = 'https://hacker-news.firebaseio.com/v0'
const TABS = [
  { id: 'top', label: 'Top', feed: 'topstories' },
  { id: 'new', label: 'New', feed: 'newstories' },
  { id: 'best', label: 'Best', feed: 'beststories' },
  { id: 'show', label: 'Show', feed: 'showstories' },
  { id: 'ask', label: 'Ask', feed: 'askstories' },
]
const PAGE_SIZE = 30
const CONCURRENCY = 6
const TIMEOUT_MS = 8000
const STALE_MS = 5 * 60 * 1000
const OPENED_MAX = 500

const $ = (id) => document.getElementById(id)
const els = { tabs: $('tabs'), list: $('list'), refresh: $('refresh'), notice: $('notice') }

const state = {
  tab: 'top',
  opened: new Set(),
  loadedAt: new Map(), // tab id -> time of the last complete load
  stories: new Map(), // tab id -> array of items (null where an item failed)
  controller: null,
}

/* ---------- Network ---------- */

// The CSP only lets the page reach hosts listed in panel.json `network`, and
// the frame's origin is opaque, so the API must answer CORS for any origin.
// Firebase does. Every request gets a timeout so a hung socket never leaves
// skeleton rows on screen forever.
async function getJson(path, signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(`${API}/${path}.json`, { signal: AbortSignal.any([signal, timeout]) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Runs `task` over `items` with at most `limit` in flight, calling `onEach`
// as each one settles so the list can fill in progressively.
async function pool(items, limit, task, onEach) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        onEach(index, await task(items[index]))
      } catch (err) {
        onEach(index, err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function load(tabId, { force = false } = {}) {
  const tab = TABS.find((t) => t.id === tabId)
  const fresh = Date.now() - (state.loadedAt.get(tabId) ?? 0) < STALE_MS

  // A newer load (another tab, a refresh) cancels the one in flight.
  state.controller?.abort()
  state.controller = null
  els.refresh.disabled = false
  if (!force && fresh && state.stories.has(tabId)) return renderStories(state.stories.get(tabId))

  const controller = (state.controller = new AbortController())
  const { signal } = controller

  // Offline, an older copy of the list beats an empty panel.
  if (!navigator.onLine) {
    if (!state.stories.has(tabId)) return renderMessage('offline')
    renderStories(state.stories.get(tabId))
    return showNotice('You are offline. This list is from earlier.')
  }
  renderSkeleton()
  els.refresh.disabled = true

  try {
    const ids = (await getJson(tab.feed, signal)).slice(0, PAGE_SIZE)
    if (signal.aborted) return
    const items = new Array(ids.length).fill(undefined)
    const rows = renderSlots(ids.length)
    await pool(ids, CONCURRENCY, (id) => getJson(`item/${id}`, signal), (index, result) => {
      if (signal.aborted) return
      // null marks a story that failed to load; false one that HN removed.
      items[index] = result instanceof Error ? null : !result || result.deleted || result.dead ? false : result
      fillSlot(rows[index], items[index])
    })
    if (signal.aborted) return
    state.stories.set(tabId, items)
    state.loadedAt.set(tabId, Date.now())
    finishSlots(rows, items)
  } catch {
    if (signal.aborted) return
    renderMessage(navigator.onLine ? 'error' : 'offline')
  } finally {
    if (state.controller === controller) {
      els.refresh.disabled = false
      els.list.setAttribute('aria-busy', 'false')
    }
  }
}

/* ---------- Opening links ---------- */

const discussionUrl = (item) => `https://news.ycombinator.com/item?id=${item.id}`

// openUrl takes https only. Most article links already are; an old http one
// is tried over https, which nearly every site answers today.
function articleUrl(item) {
  if (!item.url) return discussionUrl(item)
  const url = new URL(item.url)
  if (url.protocol === 'http:') url.protocol = 'https:'
  return url.protocol === 'https:' ? url.href : discussionUrl(item)
}

// deska.openUrl only works while the frame has focus, so it is called right
// here in the click handler, never after an await or a timer. The first link
// to a new host makes Deska ask the person; that question is Deska's own, so
// the panel shows nothing of its own while it is open.
async function open(url, item) {
  markOpened(item.id)
  try {
    await deska.openUrl(url)
    hideNotice()
  } catch (err) {
    const code = err.code ?? err.message
    // `declined`: the person said no (or another question was showing).
    // That is their answer, not a failure, so the panel stays quiet.
    if (code === 'declined') return
    if (code === 'not_focused') return showNotice('Click inside the panel first, then open the link again.')
    if (code === 'rate_limited') return showNotice('One link at a time. Try again in a second.')
    if (code === 'permission_denied') return showNotice('This panel is not allowed to open links.')
    showNotice('That link could not be opened.')
  }
}

function markOpened(id) {
  if (state.opened.has(id)) return
  state.opened.add(id)
  els.list.querySelector(`[data-id="${id}"]`)?.classList.add('is-opened')
  // Storage holds JSON values, 256 KB per package, so keep only the most
  // recent ids: 500 numbers are a few kilobytes.
  const recent = [...state.opened].slice(-OPENED_MAX)
  state.opened = new Set(recent)
  deska.storage.set('opened', recent).catch(reportStorage)
}

function reportStorage(err) {
  const code = err.code ?? err.message
  if (code === 'storage_full') showNotice('Panel storage is full, so opened stories may not stay dimmed.')
  else console.warn('[hn-front-page] storage:', code)
}

/* ---------- Rendering ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function renderTabs() {
  els.tabs.replaceChildren(
    ...TABS.map((tab) => {
      const button = el('button', 'tab', tab.label)
      button.type = 'button'
      button.id = `tab-${tab.id}`
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', String(tab.id === state.tab))
      button.tabIndex = tab.id === state.tab ? 0 : -1
      button.addEventListener('click', () => selectTab(tab.id))
      return button
    }),
  )
  els.list.setAttribute('aria-labelledby', `tab-${state.tab}`)
}

function selectTab(id, { focus = false } = {}) {
  if (id === state.tab && state.stories.has(id)) return
  state.tab = id
  renderTabs()
  if (focus) $(`tab-${id}`).focus()
  els.list.scrollTop = 0
  deska.storage.set('tab', id).catch(reportStorage)
  load(id)
}

// Arrow keys move between tabs, as a tablist should.
els.tabs.addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const index = TABS.findIndex((t) => t.id === state.tab)
  selectTab(TABS[(index + step + TABS.length) % TABS.length].id, { focus: true })
})

function renderSkeleton() {
  els.list.setAttribute('aria-busy', 'true')
  els.list.replaceChildren(...Array.from({ length: 8 }, () => skeletonRow()))
}

function skeletonRow() {
  const row = el('div', 'row skeleton')
  row.setAttribute('aria-hidden', 'true')
  row.append(el('span', 'bone bone-title'), el('span', 'bone bone-meta'))
  return row
}

function renderSlots(count) {
  const ol = el('ol', 'stories')
  const rows = Array.from({ length: count }, (_, i) => {
    const li = el('li', 'row skeleton')
    li.dataset.rank = i + 1
    li.append(el('span', 'bone bone-title'), el('span', 'bone bone-meta'))
    return li
  })
  ol.append(...rows)
  els.list.replaceChildren(ol)
  return rows
}

function fillSlot(li, item) {
  const rank = li.dataset.rank
  if (!item) {
    // A failed, deleted or dead story leaves the list; finishSlots counts it.
    li.hidden = true
    return
  }
  li.className = state.opened.has(item.id) ? 'row is-opened' : 'row'
  li.dataset.id = item.id
  li.replaceChildren(...storyContent(item, rank))
}

function storyContent(item, position) {
  // The list is an <ol>, so screen readers already announce the position.
  const rank = el('span', 'rank', `${position}.`)
  rank.setAttribute('aria-hidden', 'true')
  const title = el('button', 'title', item.title ?? 'Untitled')
  title.type = 'button'
  title.addEventListener('click', () => open(articleUrl(item), item))

  const meta = el('div', 'meta')
  const domain = item.url ? hostOf(item.url) : null
  if (domain) meta.append(el('span', 'domain', domain))
  if (item.type !== 'job') meta.append(el('span', null, plural(item.score ?? 0, 'point')))
  if (item.type !== 'job') {
    const comments = el('button', 'comments', plural(item.descendants ?? 0, 'comment'))
    comments.type = 'button'
    comments.setAttribute('aria-label', `${plural(item.descendants ?? 0, 'comment')} on Hacker News`)
    comments.addEventListener('click', () => open(discussionUrl(item), item))
    meta.append(comments)
  }
  const age = el('time', 'age', ago(item.time))
  age.dateTime = new Date(item.time * 1000).toISOString()
  age.title = new Date(item.time * 1000).toLocaleString()
  meta.append(age)

  const body = el('div', 'body')
  body.append(title, meta)
  return [rank, body]
}

// Rows were filled in place as they arrived, so the finished list is kept
// as is (focus and scroll stay put); only the leftovers are settled.
function finishSlots(rows, items) {
  if (!items.some(Boolean)) return renderStories(items)
  rows.forEach((li, i) => !items[i] && li.remove())
  const missing = items.filter((item) => item === null).length
  if (missing > 0) els.list.append(partialFooter(missing))
}

function renderStories(items) {
  const visible = items.filter(Boolean)
  if (visible.length === 0) {
    const failed = items.some((item) => item === null)
    return renderMessage(!failed ? 'empty' : navigator.onLine ? 'error' : 'offline')
  }
  const ol = el('ol', 'stories')
  items.forEach((item, i) => {
    if (!item) return
    const li = el('li', state.opened.has(item.id) ? 'row is-opened' : 'row')
    li.dataset.rank = i + 1
    li.dataset.id = item.id
    li.append(...storyContent(item, i + 1))
    ol.append(li)
  })
  const missing = items.filter((item) => item === null).length
  const children = [ol]
  if (missing > 0) children.push(partialFooter(missing))
  els.list.replaceChildren(...children)
  els.list.setAttribute('aria-busy', 'false')
}

function partialFooter(missing) {
  const footer = el('div', 'partial')
  footer.append(el('span', null, `${plural(missing, 'story', 'stories')} did not load.`), retryButton())
  return footer
}

const MESSAGES = {
  error: { title: 'Hacker News did not answer', body: 'The request failed or took too long.' },
  offline: { title: 'You are offline', body: 'The list loads again when the connection is back.' },
  empty: { title: 'Nothing here right now', body: 'This list is empty. Try another tab.' },
}

function renderMessage(kind) {
  const { title, body } = MESSAGES[kind]
  const box = el('div', 'message')
  box.append(el('p', 'message-title', title), el('p', 'message-body', body))
  if (kind !== 'empty') box.append(retryButton())
  els.list.replaceChildren(box)
  els.list.setAttribute('aria-busy', 'false')
}

function retryButton() {
  const button = el('button', 'text-button', 'Try again')
  button.type = 'button'
  button.addEventListener('click', () => load(state.tab, { force: true }))
  return button
}

let noticeTimer = null
function showNotice(text) {
  els.notice.textContent = text
  els.notice.hidden = false
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(hideNotice, 6000)
}
function hideNotice() {
  els.notice.hidden = true
}

/* ---------- Formatting ---------- */

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function ago(seconds) {
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/* ---------- Start ---------- */

els.refresh.addEventListener('click', () => load(state.tab, { force: true }))

// Coming back online loads the list again, fresh.
window.addEventListener('online', () => load(state.tab, { force: true }))

// A panel keeps running while it is scrolled off screen or behind a far-view
// card; Deska says so through `visibility`. Refresh only when the person can
// see the panel again and the list is more than five minutes old.
deska.on('visibility', ({ visible }) => {
  if (!visible) return
  const age = Date.now() - (state.loadedAt.get(state.tab) ?? 0)
  if (age > STALE_MS) load(state.tab, { force: true })
})

async function start() {
  // Wait for the host before any bridge call; the panel may have just been
  // reloaded (moved, docked, restarted), so everything comes back from storage.
  await deska.ready()
  const [tab, opened] = await Promise.all([
    deska.storage.get('tab').catch(() => null),
    deska.storage.get('opened').catch(() => null),
  ])
  if (TABS.some((t) => t.id === tab)) state.tab = tab
  if (Array.isArray(opened)) state.opened = new Set(opened)
  renderTabs()
  load(state.tab)
}

start()
