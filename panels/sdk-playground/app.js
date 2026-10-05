// SDK Playground: every call of the panel bridge behind a small form. Each
// call shows the line of code it ran, what Deska answered, and, when Deska
// refused, what that error code means.
//
// What this panel teaches:
// - deska.ready() and the init payload, plus the live deska.place, visible,
//   idle and theme values (boot, renderLive).
// - Every method: storage, setTitle, notify, openUrl, clipboard.write and
//   extras.set, each one wired the same plain way (the wire* functions).
// - Reading a refusal by err.code instead of swallowing it (call.js, errors.js).
// - Events with deska.on(), and answering an Extras control press
//   (wireEvents here, answerControl in events.js).

import { run, showLocalError, setMeaning, literal, raw } from './call.js'
import { ERROR_MEANINGS } from './errors.js'
import { answerControl, eventItem } from './events.js'

const $ = (id) => document.getElementById(id)
const OPEN_KEY = 'playground.open'
const DEFAULT_OPEN = ['init', 'storage']
const NOTIFY_EVERY_MS = 10_000
const MAX_EVENTS = 50

const outs = {}
let lastNotifyAt = 0
let countdown = null

boot()

async function boot() {
  buildOutputs()
  buildCodeList()
  const stillWaiting = setTimeout(() => {
    $('waiting').textContent = 'Deska has not answered yet. Open this page inside Deska, or with npm run preview. It keeps trying.'
  }, 3000)

  // Nothing reaches Deska before this resolves; calls made earlier are queued.
  await run(outs.init, 'const init = await deska.ready()', () => deska.ready())
  clearTimeout(stillWaiting)
  $('waiting').hidden = true
  $('sections').hidden = false
  $('app').removeAttribute('aria-busy')
  renderLive()

  await restoreOpenSections()
  wireStorage()
  wireTitle()
  wireNotify()
  wireOpenUrl()
  wireClipboard()
  wireExtras()
  wireEvents()
  wireErrorTriggers()
}

function buildOutputs() {
  const template = $('out-template').content
  for (const slot of document.querySelectorAll('[data-out]')) {
    slot.replaceWith(template.cloneNode(true))
  }
  for (const section of document.querySelectorAll('details[data-section]')) {
    outs[section.dataset.section] = section.querySelector('.out')
  }
}

function buildCodeList() {
  const list = $('codes')
  for (const [code, meaning] of Object.entries(ERROR_MEANINGS)) {
    const dt = document.createElement('dt')
    const name = document.createElement('code')
    name.textContent = code
    dt.append(name)
    const dd = document.createElement('dd')
    dd.textContent = meaning
    list.append(dt, dd)
  }
}

// --- Init ------------------------------------------------------------------

// deska.place, visible, idle and theme are plain fields the SDK keeps current;
// read them whenever you render instead of copying them at start.
function renderLive() {
  $('live-place').textContent = literal(deska.place)
  $('live-visible').textContent = literal(deska.visible)
  $('live-idle').textContent = literal(deska.idle)
  $('live-mode').textContent = literal(deska.theme?.mode ?? null)
}

// Which sections are open lives in deska.storage, the only storage that
// survives in the sandbox, so a reload (a move, a dock) keeps the layout.
async function restoreOpenSections() {
  let open = DEFAULT_OPEN
  try {
    open = (await deska.storage.get(OPEN_KEY)) ?? DEFAULT_OPEN
  } catch {
    // Unreadable storage only costs the remembered layout; the defaults do.
  }
  const sections = document.querySelectorAll('details[data-section]')
  for (const section of sections) section.open = open.includes(section.dataset.section)
  for (const section of sections) section.addEventListener('toggle', saveOpenSections)
}

function saveOpenSections() {
  const open = [...document.querySelectorAll('details[data-section]')].filter((d) => d.open).map((d) => d.dataset.section)
  // Fire and forget: if this write is refused (storage_full), the only loss
  // is the remembered layout, so a console note is enough.
  deska.storage.set(OPEN_KEY, open).catch((err) => console.warn('Could not save open sections:', err.code))
}

// --- Storage ---------------------------------------------------------------

function wireStorage() {
  $('storage-form').addEventListener('submit', (event) => event.preventDefault())
  for (const button of document.querySelectorAll('[data-storage]')) {
    button.addEventListener('click', () => storageAction(button.dataset.storage))
  }
}

function storageAction(action) {
  const key = $('storage-key').value
  const out = outs.storage
  if (action === 'keys') return run(out, 'await deska.storage.keys()', () => deska.storage.keys())
  if (action === 'get') return run(out, `await deska.storage.get(${literal(key)})`, () => deska.storage.get(key))
  if (action === 'remove') return run(out, `await deska.storage.remove(${literal(key)})`, () => deska.storage.remove(key))

  // Values are JSON: numbers, text, lists, objects. Anything that does not
  // parse is stored as the plain text it is.
  const value = parseValue($('storage-value').value)
  if (value === undefined) return showLocalError(out, 'await deska.storage.set(key, value)', 'Type a value to store.')
  return run(out, `await deska.storage.set(${literal(key)}, ${literal(value)})`, () => deska.storage.set(key, value))
}

function parseValue(text) {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// --- Title -----------------------------------------------------------------

function wireTitle() {
  $('title-form').addEventListener('submit', (event) => {
    event.preventDefault()
    // Shown under the panel's name on the canvas; an empty title clears it.
    const title = $('title-text').value.trim()
    run(outs.title, `await deska.setTitle(${literal(title)})`, () => deska.setTitle(title))
  })
}

// --- Notify ----------------------------------------------------------------

function wireNotify() {
  $('notify-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const notice = { title: $('notify-title').value.trim() }
    const body = $('notify-body').value.trim()
    if (body) notice.body = body

    // One notice every 10 s per panel: a second one inside that window is
    // refused with rate_limited, so count down instead of retrying blindly.
    const result = await run(outs.notify, `await deska.notify(${literal(notice)})`, () => deska.notify(notice))
    if (result.ok) lastNotifyAt = Date.now()
    else if (result.code === 'rate_limited' && lastNotifyAt) startCountdown()
  })
}

function startCountdown() {
  clearInterval(countdown)
  const tick = () => {
    const left = Math.ceil((lastNotifyAt + NOTIFY_EVERY_MS - Date.now()) / 1000)
    if (left > 0) return setMeaning(outs.notify, `One notice every 10 s per panel. You can send again in ${left} s.`)
    setMeaning(outs.notify, 'One notice every 10 s per panel. You can send again now.')
    clearInterval(countdown)
  }
  tick()
  countdown = setInterval(tick, 1000)
}

// --- Open URL --------------------------------------------------------------

function wireOpenUrl() {
  $('open-form').addEventListener('submit', (event) => {
    event.preventDefault()
    // Only while the panel has focus, so call it straight from the submit.
    // Deska asks the person the first time per host: expect declined.
    const url = $('open-url').value.trim()
    run(outs['open-url'], `await deska.openUrl(${literal(url)})`, () => deska.openUrl(url))
  })
}

// --- Clipboard -------------------------------------------------------------

function wireClipboard() {
  $('clipboard-form').addEventListener('submit', (event) => {
    event.preventDefault()
    // Also needs focus, and the text may be at most 64 KB.
    const text = $('clipboard-text').value
    run(outs.clipboard, `await deska.clipboard.write(${literal(text)})`, () => deska.clipboard.write(text))
  })
}

// --- Extras ----------------------------------------------------------------

function wireExtras() {
  const progress = $('extras-progress')
  progress.addEventListener('input', () => ($('extras-progress-out').value = `${progress.value}%`))

  $('extras-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const minutes = Number($('extras-until').value)
    const fields = {
      state: $('extras-state').value.trim() || null,
      progress: Number(progress.value) / 100,
      // until is a moment, not a duration: Deska counts down to it even
      // when no frame of this panel is alive.
      until: minutes > 0 ? Date.now() + minutes * 60_000 : null,
      control: $('extras-control').value || null,
    }
    const shown = { ...fields, until: minutes > 0 ? raw(`Date.now() + ${minutes} * 60_000`) : null }
    run(outs.extras, `await deska.extras.set(${literal(shown)})`, () => deska.extras.set(fields))
  })

  // null removes a field from the row; all four null leave it empty.
  $('extras-clear').addEventListener('click', () => {
    const fields = { state: null, progress: null, until: null, control: null }
    run(outs.extras, `await deska.extras.set(${literal(fields)})`, () => deska.extras.set(fields))
  })
}

// --- Events ----------------------------------------------------------------

function wireEvents() {
  // deska.on returns an unsubscribe function; this page listens for its life.
  deska.on('theme', (theme) => {
    renderLive()
    logEvent('theme', `{ mode: ${literal(theme.mode)}, tokens: {…} }`)
  })
  deska.on('visibility', (visibility) => {
    renderLive()
    logEvent('visibility', literal(visibility))
  })
  // A press on the Extras row: answer it, and keep the form in step.
  deska.on('extras.control', (payload) => {
    const next = answerControl(payload.control, outs.extras)
    $('extras-control').value = next ?? ''
    logEvent('extras.control', `${literal(payload)}, answered with control ${literal(next)}`)
  })

  $('events-clear').addEventListener('click', () => {
    $('events').replaceChildren()
    syncEventsEmpty()
  })
}

function logEvent(name, detail) {
  $('events').prepend(eventItem(name, detail))
  while ($('events').children.length > MAX_EVENTS) $('events').lastChild.remove()
  syncEventsEmpty()
}

function syncEventsEmpty() {
  const empty = $('events').children.length === 0
  $('events-empty').hidden = !empty
  $('events').hidden = empty
  $('events-actions').hidden = empty
}

// --- Error triggers --------------------------------------------------------

function wireErrorTriggers() {
  // A number where text belongs.
  $('trigger-invalid').addEventListener('click', () => {
    run(outs.errors, 'await deska.setTitle(42)', () => deska.setTitle(42))
  })
  // More than the 64 KB a call may carry.
  $('trigger-large').addEventListener('click', () => {
    run(outs.errors, "await deska.clipboard.write('x'.repeat(70_000))", () => deska.clipboard.write('x'.repeat(70_000)))
  })
}
