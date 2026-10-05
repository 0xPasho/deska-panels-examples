// Service Status: whether the services a coding day depends on are up, read
// from their public Statuspage summaries. Pick which ones to watch; a row
// opens that service's status page.
//
// What this panel teaches
// - Declaring `network` hosts in panel.json and fetching them under the CSP,
//   with one failing host never breaking the others (services.js).
// - Polling that follows deska.on('visibility'): every 2 min while seen,
//   every 10 min when hidden or idle, at once when seen again after a gap.
// - deska.notify only on a transition, deduplicated across reloads and
//   copies of the panel through deska.storage.
// - deska.extras.set with a one-line summary, and deska.openUrl with its
//   consent and error codes.

import { SERVICES, LEVELS, checkService, isIncident } from './services.js'

const deska = window.deska

const SEEN_EVERY_MS = 2 * 60_000
const UNSEEN_EVERY_MS = 10 * 60_000
const TICK_MS = 30_000
const NOTE_MS = 4_000

const KEYS = { watched: 'watched', snapshot: 'snapshot', notified: 'notified' }

const $ = (id) => document.getElementById(id)
const el = {
  panel: document.querySelector('.panel'),
  checked: $('checked'),
  edit: $('edit'),
  refresh: $('refresh'),
  list: $('list'),
  picker: $('picker'),
  choices: $('choices'),
  empty: $('empty'),
  note: $('note'),
}

const state = {
  watched: SERVICES.map((s) => s.id),
  snapshot: { checkedAt: 0, results: {} },
  checking: false,
  offline: !navigator.onLine,
  timer: null,
  noteTimer: null,
  extrasState: null,
}

start()

async function start() {
  // Nothing from the host is usable before ready(): theme tokens, place,
  // visibility and storage all arrive with init.
  await deska.ready()
  if (deska.place === 'extras') document.documentElement.classList.add('in-extras')

  // The panel can reload at any time, so everything it shows comes back from
  // storage first. Results from the last check render at once, no network.
  const [watched, snapshot] = await Promise.all([readStored(KEYS.watched), readStored(KEYS.snapshot)])
  if (Array.isArray(watched)) state.watched = watched.filter((id) => SERVICES.some((s) => s.id === id))
  if (snapshot && typeof snapshot === 'object' && snapshot.results) state.snapshot = snapshot

  buildPicker()
  render()
  el.panel.removeAttribute('aria-busy')

  // The host says when the panel scrolls off screen, folds away or the person
  // steps out. Slow down then, and catch up the moment it is seen again.
  deska.on('visibility', ({ visible, idle }) => {
    if (visible && !idle && Date.now() - state.snapshot.checkedAt >= SEEN_EVERY_MS) poll()
    else schedule()
  })

  window.addEventListener('online', () => {
    state.offline = false
    poll()
  })
  window.addEventListener('offline', () => {
    state.offline = true
    render()
  })

  setInterval(() => deska.visible && renderTimes(), TICK_MS)
  bindControls()

  // A reload within the interval reuses the stored check instead of asking
  // every status page again.
  if (Date.now() - state.snapshot.checkedAt >= SEEN_EVERY_MS) poll()
  else schedule()
}

// --- storage -----------------------------------------------------------------

async function readStored(key) {
  try {
    return await deska.storage.get(key)
  } catch (err) {
    console.warn(`[service-status] storage.get(${key}) failed: ${err.code}`)
    return null
  }
}

async function store(key, value) {
  try {
    await deska.storage.set(key, value)
  } catch (err) {
    // The SDK rejects with an Error whose `code` is the bridge error code.
    if (err.code === 'storage_full') showNote('Storage is full, so this will not survive a reload.')
    else console.warn(`[service-status] storage.set(${key}) failed: ${err.code}`)
  }
}

// --- polling -----------------------------------------------------------------

const interval = () => (deska.visible && !deska.idle ? SEEN_EVERY_MS : UNSEEN_EVERY_MS)

function schedule() {
  clearTimeout(state.timer)
  const wait = Math.max(0, state.snapshot.checkedAt + interval() - Date.now())
  state.timer = setTimeout(poll, wait)
}

async function poll() {
  if (state.checking) return
  clearTimeout(state.timer)
  state.offline = !navigator.onLine
  if (state.offline || state.watched.length === 0) {
    render()
    schedule()
    return
  }

  state.checking = true
  render()
  const watched = SERVICES.filter((s) => state.watched.includes(s.id))
  // allSettled is belt and braces: checkService never throws, and one slow or
  // broken host only ever costs its own row.
  const settled = await Promise.allSettled(watched.map(checkService))
  const results = { ...state.snapshot.results }
  watched.forEach((s, i) => {
    results[s.id] = settled[i].status === 'fulfilled' ? settled[i].value : { error: 'Unreachable' }
  })
  state.snapshot = { checkedAt: Date.now(), results }
  state.checking = false

  render()
  await store(KEYS.snapshot, state.snapshot)
  await announceTransitions(watched)
  schedule()
}

// --- notifications -----------------------------------------------------------

// Notify only when a service changes between fine and not fine. What was last
// announced lives in storage, so a reload, a second copy of this panel or a
// restart never repeats a notice the person already got.
async function announceTransitions(watched) {
  const notified = (await readStored(KEYS.notified)) || {}
  const went = { down: [], up: [] }
  const next = { ...notified }

  for (const s of watched) {
    const result = state.snapshot.results[s.id]
    if (!result || result.error) continue
    const now = isIncident(result) ? 'incident' : 'ok'
    const before = notified[s.id]
    next[s.id] = now
    // The first sighting sets a baseline: no notice for an outage that was
    // already going on when the panel was added.
    if (!before || before === now) continue
    went[now === 'incident' ? 'down' : 'up'].push({ service: s, result })
  }

  const notice = describeChanges(went)
  if (!notice) {
    if (JSON.stringify(next) !== JSON.stringify(notified)) await store(KEYS.notified, next)
    return
  }

  try {
    // notify needs the `notify` permission and is limited to once every 10 s
    // per panel, so every change from one check rides a single notice.
    await deska.notify(notice)
  } catch (err) {
    // rate_limited: keep the old record so the next check tries again.
    if (err.code === 'rate_limited') return
    if (err.code !== 'permission_denied') console.warn(`[service-status] notify failed: ${err.code}`)
  }
  await store(KEYS.notified, next)
}

// Deska refuses a notice whose body passes 240 characters rather than cutting it.
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function describeChanges({ down, up }) {
  const total = down.length + up.length
  if (total === 0) return null
  if (total === 1 && down.length === 1) {
    const { service, result } = down[0]
    return { title: `${service.name} ${LEVELS[result.indicator].word.toLowerCase()}`, body: clip(result.incident?.name || 'Its status page reports a problem.', 240) }
  }
  if (total === 1) return { title: `${up[0].service.name} recovered`, body: 'Its status page reports all systems operational.' }
  const parts = []
  if (down.length) parts.push(`Problems: ${down.map((d) => d.service.name).join(', ')}.`)
  if (up.length) parts.push(`Recovered: ${up.map((u) => u.service.name).join(', ')}.`)
  return { title: `${total} services changed`, body: parts.join(' ') }
}

// --- Extras ------------------------------------------------------------------

// The Extras row shows one short state line (60 characters at most). Send it
// only when it changes; the host keeps it after the panel closes.
async function publishExtras() {
  const text = summary()
  if (text === state.extrasState) return
  state.extrasState = text
  try {
    await deska.extras.set({ state: text })
  } catch (err) {
    state.extrasState = null
    console.warn(`[service-status] extras.set failed: ${err.code}`)
  }
}

function summary() {
  const watched = SERVICES.filter((s) => state.watched.includes(s.id))
  if (watched.length === 0) return 'No services watched'
  const results = watched.map((s) => ({ s, r: state.snapshot.results[s.id] })).filter(({ r }) => r)
  if (results.length === 0) return state.offline ? 'Offline' : 'Checking'

  const problems = results.filter(({ r }) => isIncident(r))
  if (problems.length) {
    const line = problems.map(({ s, r }) => `${s.name} ${LEVELS[r.indicator].word.toLowerCase()}`).join(', ')
    return line.length <= 60 ? line : `${problems.length} services have problems`
  }
  const failed = results.filter(({ r }) => r.error)
  if (failed.length === results.length) return state.offline ? 'Offline' : 'Could not reach any service'
  if (failed.length === 1) return `All normal, could not reach ${failed[0].s.name}`
  if (failed.length) return `All normal, ${failed.length} not reached`
  const upkeep = results.filter(({ r }) => r.indicator === 'maintenance')
  if (upkeep.length === 1) return `All normal, ${upkeep[0].s.name} in maintenance`
  return 'All systems normal'
}

// --- opening a status page ---------------------------------------------------

async function openPage(service) {
  const url = state.snapshot.results[service.id]?.url || `https://${service.host}/`
  try {
    // openUrl needs `open-url`, works only while this frame has focus (so it
    // is called straight from the click), and Deska asks the person the first
    // time for each host.
    await deska.openUrl(url)
  } catch (err) {
    const notes = {
      declined: 'Opening the page was cancelled.',
      not_focused: 'Click the panel first, then the service.',
      rate_limited: 'One page at a time. Try again in a second.',
      permission_denied: 'This panel is not allowed to open links.',
    }
    showNote(notes[err.code] || `Could not open ${service.host}.`)
  }
}

// --- rendering -----------------------------------------------------------------

function render() {
  const watched = SERVICES.filter((s) => state.watched.includes(s.id))
  const hasResults = watched.some((s) => state.snapshot.results[s.id])
  const editing = !el.picker.hidden

  el.refresh.setAttribute('aria-disabled', String(state.checking || state.watched.length === 0))
  el.list.hidden = editing || watched.length === 0 || (!hasResults && state.offline)
  el.list.replaceChildren(...watched.map(renderRow))
  renderEmpty(editing, watched.length, hasResults)
  renderTimes()
  publishExtras()
}

function renderEmpty(editing, watchedCount, hasResults) {
  let message = null
  let action = null
  if (!editing && watchedCount === 0) {
    message = 'No services watched.'
    action = ['Choose services', openPicker]
  } else if (!editing && !hasResults && state.offline) {
    message = 'You are offline. The panel checks again when you are back.'
    action = ['Try again', poll]
  }
  el.empty.hidden = !message
  if (!message) return el.empty.replaceChildren()
  const p = document.createElement('p')
  p.textContent = message
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'action'
  button.textContent = action[0]
  button.addEventListener('click', action[1])
  el.empty.replaceChildren(p, button)
}

function renderRow(service) {
  const result = state.snapshot.results[service.id]
  const li = document.createElement('li')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'row'
  button.dataset.id = service.id

  const tone = !result ? 'pending' : result.error ? 'unknown' : LEVELS[result.indicator].tone
  const word = !result ? 'Checking' : result.error ? 'Could not reach' : LEVELS[result.indicator].word
  button.dataset.tone = tone

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.setAttribute('aria-hidden', 'true')

  const main = document.createElement('span')
  main.className = 'main'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = service.name
  main.append(name)

  if (result?.incident) {
    const detail = document.createElement('span')
    detail.className = 'detail'
    detail.textContent = result.incident.name
    detail.title = result.incident.name
    const since = document.createElement('span')
    since.className = 'since'
    since.dataset.started = String(result.incident.startedAt || '')
    since.dataset.more = String(Math.max(0, result.incident.count - 1))
    main.append(detail, since)
  }

  const status = document.createElement('span')
  status.className = 'status'
  status.textContent = word

  button.append(dot, main, status)
  button.setAttribute('aria-label', `${service.name}: ${word}${result?.incident ? `, ${result.incident.name}` : ''}. Open status page`)
  button.addEventListener('click', () => openPage(service))
  li.append(button)
  return li
}

// Relative times move on their own, so they are refreshed on a slow tick
// without rebuilding the list.
function renderTimes() {
  for (const since of el.list.querySelectorAll('.since')) {
    const started = Number(since.dataset.started)
    const more = Number(since.dataset.more)
    const parts = []
    if (started) parts.push(`Started ${ago(started)}`)
    if (more) parts.push(`${more} more open`)
    since.textContent = parts.join(', ')
    since.hidden = parts.length === 0
  }
  el.checked.textContent = checkedLine()
}

function checkedLine() {
  if (state.checking) return 'Checking now'
  const at = state.snapshot.checkedAt
  if (state.offline) return at ? `Offline, last checked ${ago(at)}` : 'Offline'
  if (!at) return 'Not checked yet'
  return `Checked ${ago(at)}`
}

function ago(time) {
  const s = Math.max(0, (Date.now() - time) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function showNote(text) {
  clearTimeout(state.noteTimer)
  el.note.textContent = text
  state.noteTimer = setTimeout(() => (el.note.textContent = ''), NOTE_MS)
}

// --- choosing services ---------------------------------------------------------

function buildPicker() {
  el.choices.replaceChildren(
    ...SERVICES.map((s) => {
      const label = document.createElement('label')
      label.className = 'choice'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.value = s.id
      box.checked = state.watched.includes(s.id)
      box.addEventListener('change', onChoice)
      const name = document.createElement('span')
      name.textContent = s.name
      const host = document.createElement('span')
      host.className = 'host'
      host.textContent = s.host
      label.append(box, name, host)
      return label
    }),
  )
}

async function onChoice() {
  state.watched = [...el.choices.querySelectorAll('input:checked')].map((b) => b.value)
  await store(KEYS.watched, state.watched)
}

function openPicker() {
  el.picker.hidden = false
  el.edit.setAttribute('aria-expanded', 'true')
  render()
  // Focus moves only because the person asked for the list.
  el.choices.querySelector('input')?.focus()
}

function closePicker() {
  el.picker.hidden = true
  el.edit.setAttribute('aria-expanded', 'false')
  render()
  el.edit.focus()
  // Newly watched services have no result yet: check them now.
  if (state.watched.some((id) => !state.snapshot.results[id])) poll()
}

function bindControls() {
  el.refresh.addEventListener('click', () => {
    if (el.refresh.getAttribute('aria-disabled') === 'true') return
    poll()
  })
  el.edit.addEventListener('click', () => (el.picker.hidden ? openPicker() : closePicker()))
  // The frame has `form-action 'none'`: a submit must never navigate.
  el.picker.addEventListener('submit', (event) => {
    event.preventDefault()
    closePicker()
  })
  el.picker.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closePicker()
  })
}
