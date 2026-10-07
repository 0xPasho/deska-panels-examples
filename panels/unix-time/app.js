/* Unix Time: timestamps to dates and dates to timestamps, across the time
 * zones you pick.
 *
 * What this panel teaches:
 * - A clock that ticks every second only while the panel is visible.
 * - One copy button per value, each calling clipboard.write from its click.
 * - Reading loose input kindly: the panel says how it read what you typed
 *   ("Read as milliseconds") so a wrong guess is visible at once. */

import { findZone, isZone, offsetIn, readMoment, relative } from './time.js'
import { copyText, debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'unix-time'
const ZONES = Intl.supportedValuesOf('timeZone')
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const $ = (id) => document.getElementById(id)

let state = { input: '', zones: ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'].filter((z) => z !== LOCAL_ZONE) }
let timer = null
let moment = null

snapThemeChanges()
const init = await deska.ready()
const locale = init.locale || navigator.language

try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved.input === 'string') state.input = saved.input
  if (saved && Array.isArray(saved.zones)) state.zones = saved.zones.filter((z) => typeof z === 'string' && isZone(z)).slice(0, 12)
} catch (err) {
  showStatus(problemText(err, 'load your time zones'), 'error')
}
$('input').value = state.input || String(Math.floor(Date.now() / 1000))
$('zone-list').replaceChildren(...ZONES.map((z) => new Option(z.split('/').pop().replaceAll('_', ' '), z)))
$('app').setAttribute('aria-busy', 'false')
convert()
if (deska.visible) tick()
else renderNow()

// Now -------------------------------------------------------------------------------

function renderNow() {
  $('now').textContent = String(Math.floor(Date.now() / 1000))
}

function tick() {
  clearTimeout(timer)
  renderNow()
  // Relative times ("12 seconds ago") age too.
  if (moment) renderRelative()
  timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 10)
}

deska.on('visibility', ({ visible }) => {
  clearTimeout(timer)
  if (visible) tick()
})

$('copy-now').addEventListener('click', () => copy(String(Math.floor(Date.now() / 1000)), 'Unix time'))

// Converting ------------------------------------------------------------------------

function convert() {
  const result = readMoment($('input').value)
  const detected = $('detected')
  detected.className = 'detected'
  $('input').setAttribute('aria-invalid', String(Boolean(result.error)))
  if (result.empty) {
    moment = null
    detected.textContent = 'Paste a Unix timestamp or a date.'
  } else if (result.error) {
    moment = null
    detected.textContent = result.error
    detected.classList.add('is-error')
  } else {
    moment = result.ms
    detected.textContent = result.unit === 'now' ? 'Read as the current time.' : `Read as ${result.unit}.`
  }
  renderResults()
  renderZones()
}

function renderResults() {
  const dl = $('results')
  if (moment === null) return dl.replaceChildren()
  const date = new Date(moment)
  const rows = [
    ['Seconds', String(Math.floor(moment / 1000))],
    ['Milliseconds', String(Math.round(moment))],
    ['ISO 8601', date.toISOString()],
    ['Your time', new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date)],
    ['Relative', relative(moment, Date.now(), locale), 'relative'],
  ]
  dl.replaceChildren(...rows.map(([label, value, id]) => row(label, value, id)))
}

function renderRelative() {
  const el = document.querySelector('[data-row="relative"] .value')
  if (el) el.textContent = relative(moment, Date.now(), locale)
}

function row(label, value, id) {
  const div = document.createElement('div')
  div.className = 'row'
  if (id) div.dataset.row = id
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  const text = document.createElement('span')
  text.className = 'value'
  text.textContent = value
  const button = copyButton(`Copy ${label}`, () => text.textContent, label)
  dd.append(text, button)
  div.append(dt, dd)
  return div
}

function copyButton(name, read, label) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-button copy'
  button.setAttribute('aria-label', name)
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="7" height="8" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v5A1.5 1.5 0 0 0 5 10.5h.5" /></svg>'
  button.addEventListener('click', () => copy(read(), label))
  return button
}

async function copy(text, label) {
  const problem = await copyText(text)
  showStatus(problem || `Copied ${label}`, problem ? 'error' : 'ok')
}

const save = debounce(async () => {
  state.input = $('input').value
  try {
    await deska.storage.set(KEY, state)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 600)

const convertSoon = debounce(convert, 150)
$('input').addEventListener('input', () => {
  convertSoon()
  save()
})
$('use-now').addEventListener('click', () => {
  $('input').value = String(Math.floor(Date.now() / 1000))
  convert()
  save()
})
$('form').addEventListener('submit', (event) => {
  event.preventDefault()
  convert()
})

// Time zones ------------------------------------------------------------------------

function renderZones() {
  const list = $('zone-rows')
  if (!state.zones.length) {
    const li = document.createElement('li')
    li.className = 'muted'
    li.textContent = 'No other time zones. Add one to see this moment there.'
    return list.replaceChildren(li)
  }
  list.replaceChildren(
    ...state.zones.map((zone, index) => {
      const li = document.createElement('li')
      li.className = 'zone'
      const name = document.createElement('div')
      name.className = 'zone-name'
      const city = document.createElement('span')
      city.textContent = zone === 'UTC' ? 'UTC' : zone.split('/').pop().replaceAll('_', ' ')
      const off = document.createElement('span')
      off.className = 'muted'
      off.textContent = moment === null ? zone : offsetIn(zone, moment)
      name.append(city, off)
      const when = document.createElement('span')
      when.className = 'zone-time'
      when.textContent = moment === null ? '' : new Intl.DateTimeFormat(locale, { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(moment))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'icon-button'
      remove.setAttribute('aria-label', `Remove ${city.textContent}`)
      remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" /></svg>'
      remove.addEventListener('click', () => {
        state.zones.splice(index, 1)
        renderZones()
        save.flush()
        const buttons = $('zone-rows').querySelectorAll('button')
        ;(buttons[Math.min(index, buttons.length - 1)] || $('add-open')).focus()
      })
      li.append(name, when, remove)
      return li
    }),
  )
}

function openAdd(open) {
  $('add-form').hidden = !open
  $('add-open').setAttribute('aria-expanded', String(open))
  $('zone-error').hidden = true
  $('zone').removeAttribute('aria-invalid')
  if (open) $('zone').focus()
  else {
    $('add-form').reset()
    $('add-open').focus()
  }
}

$('add-open').addEventListener('click', () => openAdd($('add-form').hidden))
$('add-form').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') openAdd(false)
})
$('add-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const zone = findZone($('zone').value, ZONES)
  const fail = (text) => {
    $('zone-error').hidden = false
    $('zone-error').textContent = text
    $('zone').setAttribute('aria-invalid', 'true')
    $('zone').focus()
  }
  if (!zone) return fail('Pick a time zone from the list, like Europe/Berlin.')
  if (state.zones.includes(zone)) return fail('That time zone is already in the list.')
  if (state.zones.length >= 12) return fail('Twelve time zones is the most this panel keeps. Remove one first.')
  state.zones.push(zone)
  renderZones()
  save.flush()
  openAdd(false)
})
