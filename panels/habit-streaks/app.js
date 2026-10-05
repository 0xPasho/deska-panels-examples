// Habit Streaks: a few daily habits, today's check for each, the current and
// best streak, and the last 14 days at a glance. Days follow the local time
// zone and roll over at midnight while the panel stays open.
//
// What this panel teaches:
// - deska.storage as a small database: one versioned document, migrated on
//   load (habits.js `migrate`), compacted to stay far under 256 KB
//   (`compact`), and a fallback when a write answers `storage_full` (`write`).
// - Read, change, write: every copy of a package shares one storage, so each
//   change starts from a fresh read, and a copy re-reads when it is shown
//   again (`refresh`, the `visibility` listener).
// - deska.storage.keys() to show exactly what the package keeps (`renderStorage`).
// - deska.setTitle for a glanceable "2 of 3 today" on the canvas (`updateTitle`).

import {
  KEEP_DAYS,
  NewerVersionError,
  TIGHT_KEEP_DAYS,
  bestStreak,
  compact,
  currentStreak,
  dayKey,
  emptyDoc,
  isDone,
  migrate,
  msUntilNextDay,
  newHabitId,
  recentDays,
  setDone,
} from './habits.js'
import { seedDoc } from './seed.js'

// The one storage key. Everything lives in a single document so a change is
// one write: it lands whole or not at all.
const KEY = 'habits'
const STORAGE_LIMIT = 256 * 1024
const NAME_MAX = 60
const UNDO_MS = 8000

const $ = (id) => document.getElementById(id)

const state = {
  doc: null,
  today: dayKey(),
  status: 'loading', // loading | ready | error | newer
  problem: '',
  adding: false,
  renaming: null, // habit id
  menu: null, // habit id
  undo: null, // { id, key, wasDone, name }
  retry: null, // the change that failed to save
  locale: 'en-US',
  panelName: 'Habit Streaks',
}

let undoTimer = null
let rolloverTimer = null
let lastTitle

// --- Storage ------------------------------------------------------------------

/**
 * Reads the document and brings it to the current version. On the package's
 * very first run nothing is stored yet (`storage.get` answers null), and the
 * demo seed is written.
 */
async function read() {
  // Every frame of this package, on any canvas, in any project, reads and
  // writes the same keys on this computer. So this read is the truth; what
  // this copy holds in memory may be stale.
  const raw = await deska.storage.get(KEY)
  if (raw === null) {
    const doc = seedDoc(state.today) // FIRST-RUN SEED: see seed.js
    await write(doc)
    return doc
  }
  const { doc, migrated } = migrate(raw)
  const folded = compact(doc, state.today)
  // Save the upgraded shape right away, so older history is converted once
  // and not on every load.
  if (migrated || folded) await write(doc)
  return doc
}

/**
 * Writes the document. A package has 256 KB across all its keys; past that
 * Deska refuses the write with `storage_full` and keeps the old value. This
 * panel then folds more history into the streak totals and tries once more.
 */
async function write(doc) {
  try {
    await deska.storage.set(KEY, doc)
  } catch (err) {
    if (err.code !== 'storage_full' || !compact(doc, state.today, TIGHT_KEEP_DAYS)) throw err
    await deska.storage.set(KEY, doc)
  }
}

// Changes run one at a time, each as read, change, write, so two quick clicks
// (or two copies of the panel) never undo each other's work.
let queue = Promise.resolve()

// Resolves true once saved. A failed change keeps the mutation in
// `state.retry`, so the error line can offer to run it again.
function change(mutate) {
  const run = queue.then(async () => {
    let saved = false
    try {
      const doc = await read()
      mutate(doc)
      compact(doc, state.today)
      await write(doc)
      state.doc = doc
      state.status = 'ready'
      state.problem = ''
      state.retry = null
      saved = true
    } catch (err) {
      state.problem = saveProblem(err)
      state.retry = mutate
    }
    render()
    return saved
  })
  queue = run
  return run
}

/**
 * Re-reads storage: another copy of this package may have changed it. Runs in
 * the same queue as changes, and redraws only when something differs, so a
 * click that also focuses the frame is never lost to a rebuilt button.
 */
function refresh() {
  queue = queue.then(async () => {
    const before = JSON.stringify([state.today, state.status, state.doc])
    rollDay()
    try {
      state.doc = await read()
      state.status = 'ready'
    } catch (err) {
      state.status = err instanceof NewerVersionError ? 'newer' : 'error'
      state.problem = readProblem(err)
    }
    if (JSON.stringify([state.today, state.status, state.doc]) !== before) render()
  })
  return queue
}

// Bridge failures reject with an Error whose `code` is one of Deska's error
// codes. Say what happened in words a person can act on.
function saveProblem(err) {
  switch (err.code) {
    case 'storage_full':
      return 'Storage is full, so this change was not saved.'
    case 'rate_limited':
      return 'Too many changes at once. Try again in a moment.'
    case 'too_large':
      return 'This change is too large to save.'
    default:
      return `Could not save (${err.code ?? err.message}).`
  }
}

function readProblem(err) {
  if (err instanceof NewerVersionError) return 'A newer version of this panel saved these habits. Update the panel to open them.'
  if (err.code) return `Could not read your habits (${err.code}).`
  return 'Your saved habits could not be read.'
}

// --- Days and midnight ------------------------------------------------------------

/** Moves "today" forward when the date changed (midnight, wake from sleep). */
function rollDay() {
  const now = dayKey()
  if (now !== state.today) state.today = now
  clearTimeout(rolloverTimer)
  // A timer to the next local midnight, plus half a second so the new date is
  // certain. It is re-armed on every check, so a clock or time zone change
  // only needs one visibility change or render to correct itself.
  rolloverTimer = setTimeout(() => {
    rollDay()
    render()
  }, msUntilNextDay() + 500)
}

// --- Actions ---------------------------------------------------------------------

function toggle(habit) {
  const key = state.today
  const wasDone = isDone(state.doc, habit.id, key)
  hideUndo()
  // Offer undo only for a change that was saved.
  return change((doc) => setDone(doc, habit.id, key, !wasDone)).then((saved) => {
    if (saved) showUndo({ id: habit.id, key, wasDone, name: habit.name })
  })
}

function undo() {
  const u = state.undo
  if (!u) return
  hideUndo()
  // Undo restores that habit on that day, not the whole document, so a change
  // made meanwhile in another copy survives.
  change((doc) => setDone(doc, u.id, u.key, u.wasDone))
}

function addHabit(name) {
  return change((doc) => {
    doc.habits.push({ id: newHabitId(doc), name, archived: false, before: { run: 0, best: 0 } })
  })
}

function renameHabit(id, name) {
  return change((doc) => {
    const habit = doc.habits.find((h) => h.id === id)
    if (habit) habit.name = name
  })
}

function setArchived(id, archived) {
  return change((doc) => {
    const habit = doc.habits.find((h) => h.id === id)
    if (habit) habit.archived = archived
  })
}

// --- Rendering -------------------------------------------------------------------

const ICON_CHECK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_MORE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="12.5" cy="8" r="1.25" fill="currentColor"/></svg>'

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k === 'class') node.className = v
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v)
  }
  node.append(...children.filter((c) => c != null && c !== false))
  return node
}

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`

function render() {
  // Keep focus where the person left it when the list is rebuilt.
  const focused = document.activeElement?.dataset?.focus
  const doc = state.doc
  const active = doc ? doc.habits.filter((h) => !h.archived) : []
  const archived = doc ? doc.habits.filter((h) => h.archived) : []

  renderHead(active)
  const main = $('main')
  main.setAttribute('aria-busy', String(state.status === 'loading'))

  if (state.status === 'error' || state.status === 'newer') {
    main.replaceChildren(
      el('div', { class: 'state' }, el('p', {}, state.problem), el('button', { class: 'quiet', type: 'button', onclick: refresh }, 'Try again')),
    )
  } else if (state.status === 'ready') {
    main.replaceChildren(
      ...(state.problem
        ? [
            el(
              'div',
              { class: 'problem', role: 'alert' },
              el('span', {}, state.problem),
              state.retry ? el('button', { class: 'quiet small', type: 'button', onclick: () => change(state.retry) }, 'Try again') : null,
            ),
          ]
        : []),
      active.length || state.adding
        ? el('ul', { class: 'list' }, ...active.map(habitRow), state.adding ? addRow() : null)
        : el('div', { class: 'state' }, el('p', {}, 'No habits yet. Add one to start a streak.'), el('button', { class: 'quiet', type: 'button', onclick: startAdding }, 'Add a habit')),
    )
  }

  $('foot').hidden = state.status !== 'ready'
  const archivedToggle = $('archived-toggle')
  archivedToggle.hidden = archived.length === 0
  archivedToggle.textContent = `Archived (${archived.length})`
  if (archived.length === 0) setDrawer('archived', false)
  if (!$('archived').hidden) renderArchived(archived)
  if (!$('storage').hidden) renderStorage()
  updateTitle(active)

  if (focused) document.querySelector(`[data-focus="${focused}"]`)?.focus()
}

function renderHead(active) {
  const date = new Date(`${state.today}T12:00:00`)
  $('date').textContent = date.toLocaleDateString(state.locale, { weekday: 'long', month: 'long', day: 'numeric' })
  const done = active.filter((h) => isDone(state.doc, h.id, state.today)).length
  $('summary').textContent = state.status !== 'ready' ? '' : active.length ? `${done} of ${active.length} done today` : ''
  $('add').hidden = state.status !== 'ready'
}

function habitRow(habit) {
  const doc = state.doc
  const done = isDone(doc, habit.id, state.today)
  const streak = currentStreak(doc, habit, state.today)
  const best = bestStreak(doc, habit)
  const recent = recentDays(doc, habit.id, state.today)
  const recentCount = recent.filter((d) => d.done).length

  const name =
    state.renaming === habit.id
      ? nameInput(habit.name, (value) => {
          state.renaming = null
          if (value && value !== habit.name) renameHabit(habit.id, value)
          else render()
        })
      : el('span', { class: 'name' }, habit.name)

  return el(
    'li',
    { class: `habit${done ? ' is-done' : ''}` },
    el('button', {
      class: 'check',
      type: 'button',
      'aria-pressed': String(done),
      'aria-label': `${habit.name}, done today`,
      'data-focus': `check-${habit.id}`,
      html: `<span class="check-mark">${ICON_CHECK}</span>`,
      onclick: () => toggle(habit),
    }),
    el(
      'div',
      { class: 'body' },
      name,
      el(
        'div',
        { class: 'days', role: 'img', 'aria-label': `Done ${recentCount} of the last 14 days` },
        ...recent.map((d) => el('span', { class: `day${d.done ? ' on' : ''}${d.key === state.today ? ' today' : ''}`, title: d.key })),
      ),
    ),
    el('div', { class: 'streak' }, el('span', { class: 'streak-now' }, days(streak)), el('span', { class: 'streak-best' }, `Best ${best}`)),
    menuButton(habit),
  )
}

function menuButton(habit) {
  const open = state.menu === habit.id
  const wrap = el(
    'div',
    { class: 'menu-wrap' },
    el('button', {
      class: 'icon',
      type: 'button',
      'aria-label': `More for ${habit.name}`,
      'aria-haspopup': 'menu',
      'aria-expanded': String(open),
      'data-focus': `menu-${habit.id}`,
      html: ICON_MORE,
      onclick: () => {
        state.menu = open ? null : habit.id
        render()
        if (!open) document.querySelector('.menu button')?.focus()
      },
    }),
  )
  if (open) {
    const close = () => {
      state.menu = null
      render()
    }
    wrap.append(
      el(
        'div',
        { class: 'menu', role: 'menu', onkeydown: (e) => menuKeys(e, close, habit.id) },
        el('button', {
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            state.menu = null
            state.renaming = habit.id
            render()
            const input = document.querySelector('.rename')
            input?.focus()
            input?.select()
          },
        }, 'Rename'),
        el('button', {
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            state.menu = null
            setArchived(habit.id, true)
          },
        }, 'Archive'),
      ),
    )
  }
  return wrap
}

function menuKeys(e, close, id) {
  const items = [...e.currentTarget.querySelectorAll('button')]
  const i = items.indexOf(document.activeElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    document.querySelector(`[data-focus="menu-${id}"]`)?.focus()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }
}

function nameInput(value, done) {
  let settled = false
  const finish = (v) => {
    if (settled) return
    settled = true
    done(v)
  }
  return el('input', {
    class: 'rename',
    type: 'text',
    value,
    maxlength: NAME_MAX,
    'aria-label': 'Habit name',
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(e.target.value.trim())
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    },
    onblur: (e) => finish(e.target.value.trim()),
  })
}

function addRow() {
  const input = el('input', { class: 'add-input', type: 'text', maxlength: NAME_MAX, placeholder: 'New habit', 'aria-label': 'New habit name' })
  const cancel = () => {
    state.adding = false
    render()
    $('add').focus()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  return el(
    'li',
    { class: 'add-row' },
    el(
      'form',
      {
        class: 'add-form',
        // The sandbox blocks form submission (form-action 'none'): handle it here.
        onsubmit: (e) => {
          e.preventDefault()
          const name = input.value.trim()
          if (!name) return input.focus()
          state.adding = false
          addHabit(name)
        },
      },
      input,
      el('button', { class: 'primary', type: 'submit' }, 'Add'),
      el('button', { class: 'quiet', type: 'button', onclick: cancel }, 'Cancel'),
    ),
  )
}

function startAdding() {
  state.adding = true
  render()
  document.querySelector('.add-input')?.focus()
}

function renderArchived(archived) {
  $('archived').replaceChildren(
    el(
      'ul',
      { class: 'plain' },
      ...archived.map((h) =>
        el(
          'li',
          {},
          el('span', { class: 'name' }, h.name),
          el('button', { class: 'quiet small', type: 'button', 'data-focus': `restore-${h.id}`, onclick: () => setArchived(h.id, false) }, 'Restore'),
        ),
      ),
    ),
  )
}

const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)

/**
 * Lists every key this package stores, with its size. storage.keys() answers
 * for the whole package, so it also shows keys an older release left behind.
 */
async function renderStorage() {
  const box = $('storage')
  try {
    const keys = await deska.storage.keys()
    const sizes = await Promise.all(keys.map(async (k) => [k, new Blob([JSON.stringify(await deska.storage.get(k))]).size]))
    const total = sizes.reduce((sum, [, n]) => sum + n, 0)
    const dayCount = Object.keys(state.doc?.days ?? {}).length
    const share = (total / STORAGE_LIMIT) * 100
    box.replaceChildren(
      el('ul', { class: 'plain' }, ...sizes.map(([k, n]) => el('li', {}, el('code', {}, k), el('span', { class: 'num' }, kb(n))))),
      el('p', { class: 'note' }, `${kb(total)} of 256 KB used (${share < 1 ? 'under 1' : Math.round(share)}%). ${dayCount} days of history kept. Days older than ${KEEP_DAYS} are folded into the streak totals.`),
    )
  } catch (err) {
    box.replaceChildren(el('p', { class: 'note' }, `Could not list storage (${err.code ?? err.message}).`))
  }
}

/**
 * The title shows under the panel's name on the canvas, so a glance at a
 * folded or far away panel still says how the day is going. setTitle takes 1
 * to 60 characters and refuses null or '' (invalid_args): with nothing to
 * count, it gets the panel's own name back.
 */
function updateTitle(active) {
  const title = state.status === 'ready' && active.length ? `${active.filter((h) => isDone(state.doc, h.id, state.today)).length} of ${active.length} today` : state.panelName
  if (title === lastTitle) return
  lastTitle = title
  deska.setTitle(title).catch((err) => console.warn('setTitle failed:', err.code))
}

function setDrawer(id, open) {
  $(id).hidden = !open
  $(`${id}-toggle`).setAttribute('aria-expanded', String(open))
}

// --- Undo ------------------------------------------------------------------------

function showUndo(u) {
  state.undo = u
  const toast = $('toast')
  toast.replaceChildren(
    el('span', {}, `${u.name} ${u.wasDone ? 'unmarked' : 'marked done'}.`),
    el('button', { class: 'quiet small', type: 'button', onclick: undo }, 'Undo'),
  )
  toast.classList.add('shown')
  clearTimeout(undoTimer)
  undoTimer = setTimeout(hideUndo, UNDO_MS)
}

function hideUndo() {
  state.undo = null
  clearTimeout(undoTimer)
  const toast = $('toast')
  toast.classList.remove('shown')
  toast.replaceChildren()
}

// --- Wiring ----------------------------------------------------------------------

$('add').addEventListener('click', startAdding)
$('storage-toggle').addEventListener('click', () => {
  setDrawer('storage', $('storage').hidden)
  if (!$('storage').hidden) renderStorage()
})
$('archived-toggle').addEventListener('click', () => {
  setDrawer('archived', $('archived').hidden)
  render()
})

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing && state.undo) {
    e.preventDefault()
    undo()
  }
})

document.addEventListener('pointerdown', (e) => {
  if (state.menu && !e.target.closest('.menu-wrap')) {
    state.menu = null
    render()
  }
})

const init = await deska.ready()
state.locale = init.locale || state.locale
state.panelName = init.panel.name

// Deska says when the panel is shown again (scrolled back into view, its dock
// unfolded, its project reopened). Another copy of this package may have
// written meanwhile, and the date may have changed: read again.
deska.on('visibility', ({ visible }) => {
  if (visible) refresh()
})
// Two copies side by side are both visible all along; the one you click into
// re-reads when it gets focus.
window.addEventListener('focus', refresh)

await refresh()
