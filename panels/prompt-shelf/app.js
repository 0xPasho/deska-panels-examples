// Prompt Shelf: a small library of reusable prompts for coding agents.
// Search, add, edit and delete them, and copy one with a click or Enter.
// A prompt can hold {{blanks}}: copying it first asks for their values.
//
// What this panel teaches:
// - deska.clipboard.write: copying from a button press, and reading its
//   refusals (not_focused, too_large, permission_denied) by code.
// - deska.storage for a collection that grows: one key holding a versioned
//   shape ({ version: 1, items }), seeded on the first run, and a save that
//   survives storage_full without losing the person's edit.
// - Keyboard inside a sandboxed frame: / and Cmd+F, arrow keys and Enter,
//   moving focus only in answer to the person's own keys and clicks.

import { readShelf, makeItem, placeholders, fill, parts, matches } from './shelf.js'

const STORAGE_KEY = 'shelf'
const COPIED_MS = 1600

const $ = (id) => document.getElementById(id)
const el = {
  app: $('app'),
  bar: document.querySelector('.bar'),
  search: $('search'),
  newButton: $('new'),
  loading: $('loading'),
  failed: $('failed'),
  failedDetail: $('failed-detail'),
  retry: $('retry'),
  shelf: $('shelf'),
  list: $('list'),
  empty: $('empty'),
  emptyTitle: $('empty-title'),
  emptyDetail: $('empty-detail'),
  emptyAction: $('empty-action'),
  editor: $('editor'),
  editorTitle: $('editor-title'),
  editorName: $('editor-name'),
  editorText: $('editor-text'),
  editorError: $('editor-error'),
  deleteZone: $('delete-zone'),
  cancel: $('cancel'),
  status: $('status'),
}

const state = {
  view: 'loading', // loading | failed | shelf | editor
  shelf: null,
  query: '',
  filling: null, // id of the prompt whose blanks are open
  editing: null, // { id } of the prompt in the editor, id null for a new one
  returnFocus: null, // what to focus when the editor closes
}

// ---------------------------------------------------------------------------
// Storage

// The whole shelf lives under one key. A save writes the next shelf and only
// adopts it once Deska said yes, so a refusal leaves memory and storage equal.
async function save(nextShelf) {
  try {
    await deska.storage.set(STORAGE_KEY, nextShelf)
    state.shelf = nextShelf
    return null
  } catch (err) {
    return saveProblem(err.code)
  }
}

function saveProblem(code) {
  if (code === 'storage_full') return 'The shelf is full (256 KB). Delete a prompt or shorten this one, then save again.'
  if (code === 'too_large') return 'This prompt is too long to save in one go. Shorten it and save again.'
  if (code === 'rate_limited') return 'Too many changes at once. Wait a moment and save again.'
  return 'Could not save. Try again.'
}

async function load() {
  show('loading')
  let raw
  try {
    // storage.get answers null for a key never written: that is a first run.
    raw = await deska.storage.get(STORAGE_KEY)
  } catch (err) {
    el.failedDetail.textContent = err.code === 'rate_limited' ? 'Deska is busy. Try again in a moment.' : 'Deska could not read this panel’s storage.'
    show('failed')
    return
  }
  const result = readShelf(raw)
  if (result.problem) {
    // Never overwrite data we could not read: show why, and leave it be.
    el.failedDetail.textContent = result.problem
    show('failed')
    return
  }
  state.shelf = result.shelf
  show('shelf')
  if (result.fresh) {
    // Write the seed once, so deleting every prompt later stays deleted
    // instead of the seed coming back on the next reload.
    const problem = await save(result.shelf)
    if (problem) say(problem, 'error')
  }
}

// ---------------------------------------------------------------------------
// Clipboard

async function copy(item, text) {
  try {
    // Needs the clipboard-write permission and the frame's focus. A click or
    // a key press inside the panel gives it focus, so call this right from
    // the person's own action, never from a timer.
    await deska.clipboard.write(text)
  } catch (err) {
    say(copyProblem(err.code), 'error')
    return false
  }
  flashCopied(item.id)
  say(`Copied “${item.title}”`)
  return true
}

function copyProblem(code) {
  if (code === 'not_focused') return 'Click inside the panel first, then copy again.'
  if (code === 'too_large') return 'This prompt is over 64 KB, too long to copy from a panel.'
  if (code === 'permission_denied') return 'This panel is not allowed to use the clipboard.'
  if (code === 'rate_limited') return 'Too many copies at once. Wait a moment and try again.'
  return 'Could not copy. Try again.'
}

const copiedTimers = new Map()
function flashCopied(id) {
  const hint = el.list.querySelector(`[data-id="${id}"] .row-hint`)
  if (!hint) return
  hint.textContent = 'Copied'
  hint.classList.add('is-copied')
  clearTimeout(copiedTimers.get(id))
  copiedTimers.set(
    id,
    setTimeout(() => {
      hint.classList.remove('is-copied')
      hint.textContent = hintFor(itemById(id))
    }, COPIED_MS),
  )
}

// ---------------------------------------------------------------------------
// Rendering

function show(view) {
  state.view = view
  el.app.setAttribute('aria-busy', String(view === 'loading'))
  el.loading.hidden = view !== 'loading'
  el.failed.hidden = view !== 'failed'
  el.shelf.hidden = view !== 'shelf'
  el.editor.hidden = view !== 'editor'
  el.bar.hidden = view === 'editor' || view === 'failed'
  if (view === 'shelf') renderList()
}

const itemById = (id) => state.shelf?.items.find((i) => i.id === id)
const hintFor = (item) => (item && placeholders(item.text).length ? 'Fill in' : 'Copy')

function visibleItems() {
  return state.shelf.items.filter((i) => matches(i, state.query.trim()))
}

function renderList() {
  const focusedId = document.activeElement?.closest?.('.row')?.dataset.id
  const items = visibleItems()
  el.list.replaceChildren(...items.map(renderRow))
  el.list.hidden = items.length === 0
  renderEmpty(items.length)
  if (focusedId && !state.filling) el.list.querySelector(`[data-id="${focusedId}"] .row-main`)?.focus()
}

function renderEmpty(count) {
  el.empty.hidden = count > 0
  if (count > 0) return
  if (state.shelf.items.length === 0) {
    el.emptyTitle.textContent = 'No prompts yet'
    el.emptyDetail.textContent = 'Save the instructions you keep typing to your agents.'
    el.emptyAction.textContent = 'New prompt'
    el.emptyAction.dataset.action = 'new'
  } else {
    el.emptyTitle.textContent = 'No matches'
    el.emptyDetail.textContent = `Nothing on the shelf mentions “${state.query.trim()}”.`
    el.emptyAction.textContent = 'Clear search'
    el.emptyAction.dataset.action = 'clear'
  }
}

function renderRow(item) {
  const row = node('li', 'row')
  row.dataset.id = item.id

  const main = node('button', 'row-main')
  main.type = 'button'
  const blanks = placeholders(item.text)
  main.setAttribute('aria-label', `${blanks.length ? 'Fill in and copy' : 'Copy'} ${item.title}`)
  if (blanks.length) main.setAttribute('aria-expanded', String(state.filling === item.id))

  const head = node('span', 'row-head')
  head.append(node('span', 'row-title', item.title), node('span', 'row-hint', hintFor(item)))
  const preview = node('span', 'row-text')
  for (const part of parts(item.text)) preview.append(part.placeholder ? node('span', 'blank', part.text) : document.createTextNode(part.text))
  main.append(head, preview)

  const edit = node('button', 'icon-button row-edit')
  edit.type = 'button'
  edit.dataset.action = 'edit'
  edit.setAttribute('aria-label', `Edit ${item.title}`)
  edit.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5 12.5 5.5 6 12H4v-2z" /></svg>'

  const line = node('div', 'row-line')
  line.append(main, edit)
  row.append(line)
  if (state.filling === item.id) row.append(renderFill(item, blanks))
  return row
}

function renderFill(item, blanks) {
  const form = node('form', 'fill')
  form.noValidate = true
  for (const name of blanks) {
    const label = node('label', 'field')
    const input = node('textarea', 'fill-input')
    input.rows = 1
    input.name = name
    input.spellcheck = false
    label.append(node('span', 'field-label', name), input)
    form.append(label)
  }
  const actions = node('div', 'actions')
  const cancel = node('button', 'quiet', 'Cancel')
  cancel.type = 'button'
  cancel.dataset.action = 'close-fill'
  const submit = node('button', 'primary', 'Copy')
  submit.type = 'submit'
  actions.append(cancel, submit)
  form.append(actions)

  // A form in a sandbox without allow-same-origin has nowhere to go
  // (form-action 'none'), so every submit is handled here.
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(blanks.map((name) => [name, form.elements[name].value]))
    if (await copy(item, fill(item.text, values))) closeFill(item.id)
  })
  return form
}

function node(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

// Confirmations fade after a few seconds; problems stay until the next action.
let sayTimer
function say(message, tone) {
  clearTimeout(sayTimer)
  el.status.textContent = message
  el.status.classList.toggle('is-error', tone === 'error')
  if (message && tone !== 'error') sayTimer = setTimeout(() => say(''), 4000)
}

// ---------------------------------------------------------------------------
// Copy with blanks

function openFill(id) {
  state.filling = id
  renderList()
  // The person just pressed this row, so moving focus to the first blank is
  // answering their action, not taking the keyboard.
  el.list.querySelector(`[data-id="${id}"] .fill-input`)?.focus()
}

function closeFill(id) {
  state.filling = null
  renderList()
  el.list.querySelector(`[data-id="${id}"] .row-main`)?.focus()
}

function activate(id) {
  const item = itemById(id)
  if (!item) return
  if (state.filling === id) return closeFill(id)
  if (placeholders(item.text).length) return openFill(id)
  copy(item, item.text)
}

// ---------------------------------------------------------------------------
// Editor

function openEditor(id, returnFocus) {
  const item = id ? itemById(id) : null
  state.editing = { id: item ? item.id : null }
  state.filling = null
  state.returnFocus = returnFocus
  el.editorTitle.textContent = item ? 'Edit prompt' : 'New prompt'
  el.editorName.value = item ? item.title : ''
  el.editorText.value = item ? item.text : ''
  el.deleteZone.hidden = !item
  resetDelete()
  editorError('')
  say('')
  show('editor')
  el.editorName.focus()
}

function closeEditor(focusId) {
  state.editing = null
  show('shelf')
  const target = focusId ? el.list.querySelector(`[data-id="${focusId}"] .row-main`) : null
  ;(target || state.returnFocus || el.search).focus?.()
}

function editorError(message) {
  el.editorError.textContent = message
  el.editorError.hidden = !message
}

async function submitEditor() {
  const title = el.editorName.value.trim()
  const text = el.editorText.value.trim()
  if (!title) return fieldProblem(el.editorName, 'Give the prompt a name.')
  if (!text) return fieldProblem(el.editorText, 'Write the prompt itself.')

  const { id } = state.editing
  const items = id
    ? state.shelf.items.map((i) => (i.id === id ? { ...i, title, text, updatedAt: Date.now() } : i))
    : [makeItem(title, text), ...state.shelf.items]
  const problem = await save({ ...state.shelf, items })
  // On a refusal the editor stays open with everything the person typed.
  if (problem) return editorError(problem)
  closeEditor(id || items[0].id)
  say(id ? 'Saved' : 'Added to the shelf')
}

function fieldProblem(field, message) {
  editorError(message)
  field.focus()
}

function askDelete() {
  el.deleteZone.replaceChildren(
    node('span', 'confirm-text', 'Delete this prompt?'),
    Object.assign(node('button', 'quiet danger', 'Delete'), { type: 'button', id: 'delete-confirm' }),
    Object.assign(node('button', 'quiet', 'Keep'), { type: 'button', id: 'delete-keep' }),
  )
  $('delete-keep').focus()
}

function resetDelete() {
  el.deleteZone.replaceChildren(Object.assign(node('button', 'quiet danger', 'Delete'), { type: 'button', id: 'delete' }))
}

async function confirmDelete() {
  const { id } = state.editing
  const index = state.shelf.items.findIndex((i) => i.id === id)
  const items = state.shelf.items.filter((i) => i.id !== id)
  const problem = await save({ ...state.shelf, items })
  if (problem) return editorError(problem)
  const next = items[Math.min(index, items.length - 1)]
  closeEditor(next?.id)
  say('Deleted')
}

// ---------------------------------------------------------------------------
// Keyboard and clicks

const isTyping = (target) => target.matches?.('input, textarea')

function focusSearch() {
  if (state.view !== 'shelf') return
  el.search.focus()
  el.search.select()
}

function moveRow(from, step) {
  const rows = [...el.list.querySelectorAll('.row-main')]
  const index = rows.indexOf(from)
  if (step === -1 && index <= 0) return el.search.focus()
  const target = step === 'first' ? rows[0] : step === 'last' ? rows.at(-1) : rows[index + step]
  target?.focus()
}

// The panel only hears keys while the person has focused it, and it only ever
// moves focus within itself in answer to those keys.
document.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    return focusSearch()
  }
  if (event.key === '/' && !mod && !isTyping(event.target)) {
    event.preventDefault()
    return focusSearch()
  }
  if (event.key === 'Escape') return onEscape(event)

  const target = event.target
  if (target === el.search && event.key === 'ArrowDown') {
    event.preventDefault()
    return moveRow(null, 'first')
  }
  if (target === el.search && event.key === 'Enter') {
    event.preventDefault()
    return moveRow(null, 'first')
  }
  if (target.classList?.contains('row-main')) {
    const steps = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
    if (event.key in steps) {
      event.preventDefault()
      moveRow(target, steps[event.key])
    }
  }
  if (target.classList?.contains('fill-input') && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    target.form.requestSubmit()
  }
})

function onEscape(event) {
  if (state.view === 'editor') {
    event.preventDefault()
    if ($('delete-keep')) {
      resetDelete()
      return $('delete').focus()
    }
    return closeEditor(state.editing.id)
  }
  if (state.filling) {
    event.preventDefault()
    return closeFill(state.filling)
  }
  if (event.target === el.search && el.search.value) {
    event.preventDefault()
    el.search.value = ''
    state.query = ''
    renderList()
  }
}

el.search.addEventListener('input', () => {
  state.query = el.search.value
  state.filling = null
  say('')
  renderList()
})

el.list.addEventListener('click', (event) => {
  const row = event.target.closest('.row')
  if (!row) return
  if (event.target.closest('.row-main')) return activate(row.dataset.id)
  const action = event.target.closest('[data-action]')?.dataset.action
  if (action === 'edit') openEditor(row.dataset.id, event.target.closest('button'))
  if (action === 'close-fill') closeFill(row.dataset.id)
})

el.newButton.addEventListener('click', () => openEditor(null, el.newButton))
el.retry.addEventListener('click', load)
el.emptyAction.addEventListener('click', () => {
  if (el.emptyAction.dataset.action === 'new') return openEditor(null, el.newButton)
  el.search.value = ''
  state.query = ''
  renderList()
  el.search.focus()
})

el.editor.addEventListener('submit', (event) => {
  event.preventDefault()
  submitEditor()
})
el.cancel.addEventListener('click', () => closeEditor(state.editing.id))
el.deleteZone.addEventListener('click', (event) => {
  const id = event.target.closest('button')?.id
  if (id === 'delete') askDelete()
  if (id === 'delete-keep') {
    resetDelete()
    $('delete').focus()
  }
  if (id === 'delete-confirm') confirmDelete()
})
for (const field of [el.editorName, el.editorText]) field.addEventListener('input', () => editorError(''))
el.editorText.addEventListener('keydown', (event) => {
  // Cmd+Enter saves from the prompt field, where Enter is a new line.
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    el.editor.requestSubmit()
  }
})

// A theme change repaints every color at once: switch transitions off for a
// frame so the flip snaps instead of smearing.
deska.on('theme', () => {
  document.documentElement.classList.add('no-transitions')
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('no-transitions')))
})

// ---------------------------------------------------------------------------
// Start. ready() resolves once Deska answered; the SDK has already applied
// the theme tokens by then. The panel may reload at any time, so everything
// is rebuilt from storage here.

await deska.ready()
await load()
