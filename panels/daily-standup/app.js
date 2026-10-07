/* Daily Standup: yesterday, today and blockers, one note per day, copied as
 * Markdown for the team chat.
 *
 * What this panel teaches:
 * - Saving while the person types: a debounced storage.set, flushed when the
 *   panel hides, with a "Saved" state the person can trust.
 * - clipboard.write from a click or a shortcut, and its refusals.
 * - Dated documents in storage: one key, compacted to the last 60 days. */

import { FIELDS, compact, dateOf, dayKey, isEmpty, previousPlan, readDoc, shiftDay, toMarkdown } from './notes.js'
import { copyText, debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'standup'
const $ = (id) => document.getElementById(id)
const inputs = { yesterday: $('yesterday'), today: $('today-text'), blockers: $('blockers') }

let init
let doc = null
let readOnly = false
let current = dayKey(new Date())
let dirty = false

snapThemeChanges()
init = await deska.ready()
const locale = init.locale || navigator.language
const isMac = /mac/i.test(navigator.platform)
document.querySelector('.mod-key').textContent = isMac ? '⌘' : 'Ctrl'
await load()

// Loading -----------------------------------------------------------------------

async function load() {
  $('loading').hidden = false
  $('failed').hidden = true
  try {
    const result = readDoc(await deska.storage.get(KEY))
    if (result.newer) {
      // A newer version of this panel saved here. Show nothing editable
      // rather than write an older shape over the person's notes.
      readOnly = true
      doc = { days: {} }
      showStatus('These notes were saved by a newer version of this panel. Update it to edit them.', 'error')
    } else {
      doc = result.doc
    }
    $('loading').hidden = true
    $('note').hidden = false
    $('app').setAttribute('aria-busy', 'false')
    show(current)
  } catch (err) {
    $('loading').hidden = true
    $('failed').hidden = false
    $('failed-detail').textContent = problemText(err, 'load your notes')
  }
}

$('retry').addEventListener('click', load)

// Showing a day -------------------------------------------------------------------

function show(key) {
  current = key
  const note = doc.days[key] || { yesterday: '', today: '', blockers: '' }
  for (const field of FIELDS) {
    inputs[field].value = note[field]
    inputs[field].readOnly = readOnly
  }
  const todayKey = dayKey(new Date())
  $('day').textContent = labelFor(key, todayKey)
  $('next').disabled = key >= todayKey
  $('today').hidden = key === todayKey
  updateCarry()
  updateTitle()
}

function labelFor(key, todayKey) {
  const date = dateOf(key)
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  if (key === todayKey) return `Today, ${day}`
  if (key === shiftDay(todayKey, -1)) return `Yesterday, ${day}`
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)
}

// When yesterday's note had a plan and this day's Yesterday is still empty,
// offer to bring that plan in: it is usually what got done.
function updateCarry() {
  const button = $('carry')
  const plan = !readOnly && !inputs.yesterday.value.trim() ? previousPlan(doc, current) : null
  button.hidden = !plan
  if (!plan) return
  const from = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dateOf(plan.key))
  button.textContent = `Bring in ${from}'s plan`
  button.onclick = () => {
    inputs.yesterday.value = plan.text
    edited()
    inputs.yesterday.focus()
  }
}

function updateTitle() {
  const lines = inputs.today.value.split('\n').filter((l) => l.trim()).length
  const title = current === dayKey(new Date()) && lines ? `${lines} ${lines === 1 ? 'item' : 'items'} for today` : init.panel.name
  deska.setTitle(title).catch(() => {})
}

$('prev').addEventListener('click', () => go(-1))
$('next').addEventListener('click', () => go(1))
$('today').addEventListener('click', () => {
  save.flush()
  show(dayKey(new Date()))
})

function go(days) {
  save.flush()
  const next = shiftDay(current, days)
  if (next > dayKey(new Date())) return
  show(next)
}

// Saving ----------------------------------------------------------------------------

function edited() {
  if (readOnly) return
  doc.days[current] = Object.fromEntries(FIELDS.map((f) => [f, inputs[f].value]))
  dirty = true
  updateCarry()
  updateTitle()
  save()
}

const save = debounce(async () => {
  if (!dirty || readOnly) return
  dirty = false
  const next = compact(doc, dayKey(new Date()))
  // Keep the day on screen even when it is empty, so typing never loses it.
  if (isEmpty(doc.days[current])) delete next.days[current]
  try {
    await deska.storage.set(KEY, next)
  } catch (err) {
    dirty = true
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 600)

for (const field of FIELDS) inputs[field].addEventListener('input', edited)

// A panel can reload at any moment (moving to a dock, an update): write what
// is pending the moment it hides.
deska.on('visibility', ({ visible }) => {
  if (!visible) save.flush()
})
addEventListener('pagehide', () => save.flush())

// Copying ---------------------------------------------------------------------------

async function copy() {
  const note = Object.fromEntries(FIELDS.map((f) => [f, inputs[f].value]))
  if (isEmpty(note)) {
    showStatus('Write something first: there is nothing to copy yet.', 'error')
    inputs.yesterday.focus()
    return
  }
  const label = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric' }).format(dateOf(current))
  const problem = await copyText(toMarkdown(note, label))
  if (problem) showStatus(problem, 'error')
  else showStatus('Copied as Markdown', 'ok')
}

$('copy').addEventListener('click', copy)
$('note').addEventListener('submit', (event) => event.preventDefault())
addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    copy()
  }
})
