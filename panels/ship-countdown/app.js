// Ship Countdown: counts down to a launch, a demo or a deadline. Each
// countdown shows the days, hours and minutes left and how much of its
// run-up (from the moment it was set to the target) has gone by. The soonest
// one drives the package's row in Extras.
//
// What this panel teaches:
// - contributes.extras with a view page of its own (extras.html), and
//   deska.extras.set({ state, until, progress, control }) in countdowns.js.
// - `until`: Deska keeps counting in Extras with no frame of this package alive.
// - deska.on('extras.control'): the row's stop control dismisses a finished countdown.
// - Two pages, one package: index.html and extras.html share deska.storage,
//   and deska.notify fires once per countdown even across reloads.

import {
  load,
  update,
  makeId,
  sorted,
  isDone,
  elapsed,
  left,
  shippedAgo,
  formatTarget,
  syncExtras,
  notifyFinished,
  dismissFinished,
  describeError,
} from './countdowns.js'

const $ = (id) => document.getElementById(id)
const els = {
  status: $('status'),
  error: $('error'),
  errorText: $('error-text'),
  list: $('list'),
  empty: $('empty'),
  footer: $('footer'),
  toggle: $('add-toggle'),
  form: $('form'),
  name: $('name'),
  date: $('date'),
  time: $('time'),
  formError: $('form-error'),
}

let locale = 'en-US'
let countdowns = []
let shape = ''
let timer = null
const rows = new Map()
const pad = (n) => String(n).padStart(2, '0')

// ---- Rendering --------------------------------------------------------------

function unit(value, label) {
  const span = document.createElement('span')
  span.className = 'unit'
  const num = document.createElement('b')
  num.textContent = value
  const small = document.createElement('small')
  small.textContent = label
  span.append(num, small)
  return span
}

function buildRow(c, lead) {
  const li = document.createElement('li')
  li.className = lead ? 'row lead' : 'row'

  const head = document.createElement('div')
  head.className = 'row-head'
  const titles = document.createElement('div')
  titles.className = 'titles'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = c.name
  const meta = document.createElement('span')
  meta.className = 'meta'
  meta.textContent = formatTarget(c, locale)
  titles.append(name, meta)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'icon'
  remove.setAttribute('aria-label', `Remove ${c.name}`)
  remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>'
  remove.addEventListener('click', () => removeCountdown(c.id))
  head.append(titles, remove)

  const clock = document.createElement('p')
  clock.className = 'clock'
  const bar = document.createElement('div')
  bar.className = 'bar'
  bar.setAttribute('aria-hidden', 'true')
  const fill = document.createElement('i')
  bar.append(fill)
  const note = document.createElement('p')
  note.className = 'note'

  li.append(head, clock, bar, note)
  rows.set(c.id, { li, clock, fill, note })
  return li
}

/** Rebuilds rows only when the list itself changed, so focus on a button survives the per-second tick. */
function render(now = Date.now()) {
  els.status.hidden = true
  els.error.hidden = true
  els.footer.hidden = false
  const list = sorted(countdowns, now)
  const nextShape = list.map((c) => `${c.id}:${c.name}:${c.target}:${isDone(c, now)}`).join('|')
  if (nextShape !== shape) {
    shape = nextShape
    rows.clear()
    els.list.replaceChildren(...list.map((c, i) => buildRow(c, i === 0)))
  }
  els.list.hidden = list.length === 0
  els.empty.hidden = list.length > 0
  for (const c of list) paint(c, now)
}

function paint(c, now) {
  const row = rows.get(c.id)
  if (!row) return
  const done = isDone(c, now)
  row.li.classList.toggle('done', done)
  const share = elapsed(c, now)
  row.fill.style.transform = `scaleX(${share})`
  if (done) {
    row.clock.replaceChildren(shippedAgo(c, now))
    row.clock.removeAttribute('aria-label')
    row.note.textContent = ''
    return
  }
  const { days, hours, minutes } = left(c, now)
  row.clock.replaceChildren(unit(days, days === 1 ? 'day' : 'days'), unit(pad(hours), 'h'), unit(pad(minutes), 'min'))
  row.clock.setAttribute('aria-label', `${days} days, ${hours} hours, ${minutes} minutes left`)
  row.note.textContent = `${Math.floor(share * 100)}% of the run-up elapsed`
}

function showError(err) {
  els.status.hidden = true
  els.list.hidden = true
  els.empty.hidden = true
  els.footer.hidden = true
  els.errorText.textContent = describeError(err)
  els.error.hidden = false
}

// ---- The tick -----------------------------------------------------------------

// Every tick re-reads storage (through notifyFinished), so a countdown added,
// removed or dismissed from the Extras view shows up here within a second.
async function tick() {
  const now = Date.now()
  try {
    countdowns = await notifyFinished(now)
    render(now)
    await syncExtras(countdowns, now)
  } catch (err) {
    showError(err)
    return
  }
  schedule()
}

// Deska tells a frame when it is off screen or the computer is idle: tick on
// the second while someone can see it, every 15 s otherwise. The slow tick
// still catches a countdown reaching zero; Extras keeps its own clock from `until`.
function schedule() {
  clearTimeout(timer)
  const watching = deska.visible && !deska.idle
  const wait = watching ? 1000 - (Date.now() % 1000) + 5 : 15_000
  timer = setTimeout(tick, wait)
}

// ---- Changes ------------------------------------------------------------------

async function change(fn) {
  try {
    countdowns = await update(fn)
    render()
    await syncExtras(countdowns, Date.now())
  } catch (err) {
    showError(err)
  }
}

function removeCountdown(id) {
  const list = sorted(countdowns, Date.now())
  const index = list.findIndex((c) => c.id === id)
  change((all) => all.filter((c) => c.id !== id))
  // The row and its button are gone: move focus to a neighbour so a keyboard
  // user is not dropped at the top of the page.
  requestAnimationFrame(() => {
    const buttons = els.list.querySelectorAll('.icon')
    const target = buttons[Math.min(index, buttons.length - 1)] || els.toggle
    target.focus()
  })
}

// ---- The form -----------------------------------------------------------------

function setFormOpen(open, { focus = false } = {}) {
  els.form.hidden = !open
  els.toggle.hidden = open
  els.toggle.setAttribute('aria-expanded', String(open))
  els.formError.hidden = true
  if (open) {
    const tomorrow = new Date(Date.now() + 86_400_000)
    els.date.value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
    els.time.value = '10:00'
    els.name.value = ''
    els.form.scrollIntoView({ block: 'nearest' })
    // Focus moves only in answer to the person's own click or key press.
    if (focus) els.name.focus()
  } else if (focus) {
    els.toggle.focus()
  }
}

function formFail(message, field) {
  els.formError.textContent = message
  els.formError.hidden = false
  field.focus()
}

els.toggle.addEventListener('click', () => setFormOpen(true, { focus: true }))
$('cancel').addEventListener('click', () => setFormOpen(false, { focus: true }))
els.form.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setFormOpen(false, { focus: true })
})

els.form.addEventListener('submit', async (e) => {
  // The frame's policy is form-action 'none': a real submit would be blocked,
  // so the page always handles the form itself.
  e.preventDefault()
  const name = els.name.value.trim()
  if (!name) return formFail('Give the countdown a name.', els.name)
  if (!els.date.value || !els.time.value) return formFail('Pick a date and a time.', els.date.value ? els.time : els.date)
  const target = new Date(`${els.date.value}T${els.time.value}`).getTime()
  if (!(target > Date.now())) return formFail('Pick a time in the future.', els.date)
  await change((all) => [...all, { id: makeId(), name, target, setAt: Date.now(), notified: false, dismissed: false }])
  setFormOpen(false, { focus: true })
})

$('retry').addEventListener('click', start)

// ---- Start --------------------------------------------------------------------

async function start() {
  els.error.hidden = true
  els.status.hidden = false
  try {
    countdowns = await load()
  } catch (err) {
    showError(err)
    return
  }
  render()
  tick()
}

// The init payload carries the locale for dates; theme tokens arrive as CSS
// custom properties on <html>, so the stylesheet needs no listener.
const init = await deska.ready()
locale = init.locale || locale

deska.on('visibility', schedule)

// The Extras row's round control. Deska sends it to every live frame of the
// package (and opens the panel first when none is alive):
// stop dismisses the finished countdown the row shows, start opens the form.
deska.on('extras.control', async ({ control }) => {
  if (control === 'stop') {
    try {
      countdowns = await dismissFinished(Date.now())
      await syncExtras(countdowns, Date.now())
    } catch (err) {
      showError(err)
    }
  } else if (control === 'start') {
    setFormOpen(true)
  }
})

start()
