/* JSON Formatter: format, minify and sort JSON, point at the exact spot of a
 * syntax error, and compare two documents.
 *
 * What this panel teaches:
 * - Errors that help: the parser's position becomes a line and column, and
 *   "Show me" selects the spot in the text.
 * - Editing a textarea so Undo still works (execCommand('insertText') rather
 *   than setting .value).
 * - Keeping storage small: big inputs are not saved, and the panel says so. */

import { describe, diff, format, parse, short } from './json.js'
import { copyText, debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'session'
const SAVE_LIMIT = 60_000
const $ = (id) => document.getElementById(id)

const SAMPLE_LEFT = '{"name": "deska-panels", "version": "1.0.0", "private": true, "tags": ["panels", "examples"]}'
const SAMPLE_RIGHT = '{"name": "deska-panels", "version": "1.1.0", "tags": ["panels", "examples", "json"], "license": "MIT"}'

let state = { mode: 'format', indent: '2', sort: false, source: '', left: SAMPLE_LEFT, right: SAMPLE_RIGHT }

snapThemeChanges()
const init = await deska.ready()
try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved === 'object') {
    for (const k of ['source', 'left', 'right']) if (typeof saved[k] === 'string') state[k] = saved[k]
    if (['2', '4', 'tab'].includes(saved.indent)) state.indent = saved.indent
    state.sort = saved.sort === true
    if (saved.mode === 'compare') state.mode = 'compare'
  }
} catch (err) {
  showStatus(problemText(err, 'load your last session'), 'error')
}
if (!state.source) state.source = JSON.stringify(JSON.parse(SAMPLE_RIGHT))


// Format --------------------------------------------------------------------------

let lastError = null

function check() {
  const result = parse($('source').value)
  const summary = $('summary')
  summary.replaceChildren()
  summary.className = 'summary'
  lastError = null
  $('source').removeAttribute('aria-invalid')
  if (result.empty) {
    summary.textContent = 'Paste JSON to check and format it.'
    return null
  }
  if ('error' in result) {
    lastError = result
    $('source').setAttribute('aria-invalid', 'true')
    summary.classList.add('is-error')
    const where = result.line ? `Line ${result.line}, column ${result.column}: ` : ''
    summary.append(`${where}${result.error}.`)
    if (result.offset !== null) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'link'
      button.textContent = 'Show me'
      button.addEventListener('click', showError)
      summary.append(' ', button)
    }
    return null
  }
  const size = new Blob([$('source').value]).size
  summary.classList.add('is-ok')
  summary.textContent = `Valid JSON: ${describe(result.value)}, ${formatBytes(size)}.`
  return result
}

function showError() {
  if (!lastError || lastError.offset === null) return
  const box = $('source')
  box.focus()
  box.setSelectionRange(lastError.offset, Math.min(lastError.offset + 1, box.value.length))
}

function formatBytes(n) {
  if (n < 1024) return `${n} bytes`
  return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`
}

/** Replaces the whole text in a way the textarea's Undo remembers. */
function replaceText(box, text) {
  box.focus()
  box.select()
  if (!document.execCommand('insertText', false, text)) box.value = text
  box.setSelectionRange(0, 0)
  box.scrollTop = 0
}

function reformat(minify) {
  const result = check()
  if (!result) {
    if (lastError) showError()
    return
  }
  const text = format(result.value, minify ? 0 : state.indent, state.sort)
  replaceText($('source'), text)
  check()
  saveSoon()
}

$('format').addEventListener('click', () => reformat(false))
$('minify').addEventListener('click', () => reformat(true))
$('indent').addEventListener('change', () => {
  state.indent = $('indent').value
  saveSoon()
})
$('sort').addEventListener('change', () => {
  state.sort = $('sort').checked
  saveSoon()
})
$('source').addEventListener('input', () => {
  checkSoon()
  saveSoon()
})
const checkSoon = debounce(check, 250)

// Compare -------------------------------------------------------------------------

function compare() {
  const a = parse($('left').value)
  const b = parse($('right').value)
  const list = $('diff')
  list.replaceChildren()
  for (const [id, r] of [['left', a], ['right', b]]) $(id).setAttribute('aria-invalid', String('error' in r))
  const problem = (r, side) => ('error' in r ? `${side} is not valid JSON${r.line ? ` (line ${r.line}, column ${r.column})` : ''}: ${r.error}.` : null)
  if (a.empty || b.empty) {
    $('diff-title').textContent = 'Paste JSON on both sides to compare.'
    return null
  }
  const bad = problem(a, 'Before') || problem(b, 'After')
  if (bad) {
    $('diff-title').textContent = bad
    $('diff-title').className = 'diff-title is-error'
    return null
  }
  $('diff-title').className = 'diff-title'
  const { changes, capped } = diff(a.value, b.value)
  $('diff-title').textContent = changes.length === 0 ? 'No differences: the two documents hold the same data.' : `${capped ? 'First ' : ''}${changes.length} ${changes.length === 1 ? 'difference' : 'differences'}`
  for (const c of changes) list.append(diffRow(c))
  deska.setTitle(changes.length ? `${changes.length} ${changes.length === 1 ? 'difference' : 'differences'}` : 'No differences').catch(() => {})
  return changes
}

function diffRow(c) {
  const li = document.createElement('li')
  li.className = `change ${c.kind}`
  const sign = document.createElement('span')
  sign.className = 'sign'
  sign.textContent = { added: '+', removed: '−', changed: '~' }[c.kind]
  sign.setAttribute('aria-hidden', 'true')
  const body = document.createElement('div')
  body.className = 'change-body'
  const path = document.createElement('code')
  path.className = 'path'
  path.textContent = c.path
  const what = document.createElement('span')
  what.className = 'what'
  if (c.kind === 'added') what.textContent = `Added ${short(c.after)}`
  else if (c.kind === 'removed') what.textContent = `Removed ${short(c.before)}`
  else what.textContent = `${short(c.before, 40)} → ${short(c.after, 40)}`
  body.append(path, what)
  li.append(sign, body)
  return li
}

function diffText(changes) {
  return changes
    .map((c) => {
      if (c.kind === 'added') return `+ ${c.path}: ${JSON.stringify(c.after)}`
      if (c.kind === 'removed') return `- ${c.path}: ${JSON.stringify(c.before)}`
      return `~ ${c.path}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`
    })
    .join('\n')
}

const compareSoon = debounce(compare, 250)
for (const id of ['left', 'right']) {
  $(id).addEventListener('input', () => {
    compareSoon()
    saveSoon()
  })
}

// Mode, copy, keys, saving --------------------------------------------------------

function setMode(mode) {
  state.mode = mode
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  $('format-view').hidden = mode !== 'format'
  $('compare-view').hidden = mode !== 'compare'
  $('copy-label').textContent = mode === 'format' ? 'Copy' : 'Copy differences'
  if (mode === 'format') check()
  else compare()
  if (mode === 'format') deska.setTitle(init.panel.name).catch(() => {})
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode)
    saveSoon()
  })
}

$('copy').addEventListener('click', async () => {
  let text
  if (state.mode === 'format') {
    text = $('source').value
    if (!text.trim()) return showStatus('Nothing to copy yet.', 'error')
  } else {
    const changes = compare()
    if (!changes) return showStatus('Fix both sides first, then copy the differences.', 'error')
    if (!changes.length) return showStatus('There are no differences to copy.', 'error')
    text = diffText(changes)
  }
  const problem = await copyText(text)
  showStatus(problem || 'Copied', problem ? 'error' : 'ok')
})

addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    if (state.mode === 'format') reformat(false)
    else compare()
  }
})

let warnedBig = false
const saveSoon = debounce(async () => {
  state.source = $('source').value
  state.left = $('left').value
  state.right = $('right').value
  // Storage is 256 KB for the whole package. A big paste stays on screen but
  // is not kept; say so once rather than fail on every keystroke.
  const big = [state.source, state.left, state.right].some((t) => t.length > SAVE_LIMIT)
  const toSave = { ...state }
  for (const k of ['source', 'left', 'right']) if (toSave[k].length > SAVE_LIMIT) toSave[k] = ''
  if (big && !warnedBig) {
    warnedBig = true
    showStatus('That is too large to keep after a reload, so it is not saved.', 'error')
  }
  try {
    await deska.storage.set(KEY, toSave)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 800)

// Start ----------------------------------------------------------------------------

$('source').value = state.source
$('left').value = state.left
$('right').value = state.right
$('indent').value = state.indent
$('sort').checked = state.sort
setMode(state.mode)
$('app').setAttribute('aria-busy', 'false')
