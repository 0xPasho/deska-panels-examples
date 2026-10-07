/* Cron Explainer: a cron expression in plain words, field by field, with its
 * next runs.
 *
 * What this panel teaches:
 * - A live title: the canvas shows when the schedule runs next, refreshed on
 *   the minute only while the panel is visible.
 * - Validation as you type that explains what to change, never just "invalid".
 * - init.locale for dates, and a time zone switch kept in storage. */

import { CronError, FIELDS, describe, fieldMeaning, nextRuns, parseCron } from './cron.js'
import { debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'cron'
const $ = (id) => document.getElementById(id)
let state = { expr: '0 9 * * 1-5', zone: 'local' }
let cron = null
let timer = null

snapThemeChanges()
const init = await deska.ready()
const locale = init.locale || navigator.language

try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved.expr === 'string') state.expr = saved.expr
  if (saved && (saved.zone === 'local' || saved.zone === 'UTC')) state.zone = saved.zone
} catch (err) {
  showStatus(problemText(err, 'load your last expression'), 'error')
}
$('expr').value = state.expr
setZone(state.zone)
$('app').setAttribute('aria-busy', 'false')
read()
if (deska.visible) tick()

// Reading -------------------------------------------------------------------------

function read() {
  try {
    cron = parseCron($('expr').value)
    $('error').hidden = true
    $('expr').setAttribute('aria-invalid', 'false')
    $('words').textContent = describe(cron)
    $('words').classList.remove('is-muted')
  } catch (err) {
    if (!(err instanceof CronError)) throw err
    cron = null
    $('error').hidden = false
    $('error').textContent = err.message
    $('expr').setAttribute('aria-invalid', String(Boolean($('expr').value.trim())))
    $('words').textContent = 'Nothing to explain yet.'
    $('words').classList.add('is-muted')
  }
  renderFields()
  renderRuns()
}

function renderFields() {
  const body = $('fields').tBodies[0]
  if (!cron) return body.replaceChildren()
  body.replaceChildren(
    ...FIELDS.map((f, i) => {
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.scope = 'row'
      th.textContent = f.label
      const code = document.createElement('td')
      code.className = 'mono'
      code.textContent = cron.source.split(' ')[i]
      const meaning = document.createElement('td')
      meaning.textContent = fieldMeaning(cron, i)
      tr.append(th, code, meaning)
      return tr
    }),
  )
}

function renderRuns() {
  const list = $('runs')
  if (!cron) {
    list.replaceChildren()
    deska.setTitle(init.panel.name).catch(() => {})
    return
  }
  const now = new Date()
  const runs = nextRuns(cron, now, 5, state.zone)
  if (!runs.length) {
    const li = document.createElement('li')
    li.className = 'muted'
    li.textContent = 'This never runs in the next five years. Check the day and month: February has no 30th or 31st.'
    list.replaceChildren(li)
    deska.setTitle('Never runs').catch(() => {})
    return
  }
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: state.zone === 'UTC' ? 'UTC' : undefined,
  })
  list.replaceChildren(
    ...runs.map((date) => {
      const li = document.createElement('li')
      const when = document.createElement('time')
      when.dateTime = date.toISOString()
      when.textContent = fmt.format(date)
      const rel = document.createElement('span')
      rel.className = 'rel'
      rel.textContent = relative(date - now)
      li.append(when, rel)
      return li
    }),
  )
  deska.setTitle(`Next run ${relative(runs[0] - now)}`).catch(() => {})
}

function relative(ms) {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `in ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`
  const days = Math.round(h / 24)
  return `in ${days} ${days === 1 ? 'day' : 'days'}`
}

// The list ages each minute. Only redraw while someone can see it.
function tick() {
  clearTimeout(timer)
  renderRuns()
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
}
deska.on('visibility', ({ visible }) => {
  clearTimeout(timer)
  if (visible) tick()
})

// Input, presets, zone, saving --------------------------------------------------------

const save = debounce(async () => {
  state.expr = $('expr').value
  try {
    await deska.storage.set(KEY, state)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 600)

const readSoon = debounce(read, 150)
$('expr').addEventListener('input', () => {
  readSoon()
  save()
})

for (const chip of document.querySelectorAll('[data-expr]')) {
  chip.addEventListener('click', () => {
    $('expr').value = chip.dataset.expr
    read()
    save()
  })
}

function setZone(zone) {
  state.zone = zone
  for (const b of document.querySelectorAll('[data-zone]')) b.setAttribute('aria-pressed', String(b.dataset.zone === zone))
}

for (const b of document.querySelectorAll('[data-zone]')) {
  b.addEventListener('click', () => {
    setZone(b.dataset.zone)
    renderRuns()
    save()
  })
}

$('form').addEventListener('submit', (event) => {
  event.preventDefault()
  read()
})
