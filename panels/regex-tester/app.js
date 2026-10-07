/* Regex Tester: a JavaScript regular expression against your own text, with
 * live highlights, groups and replace.
 *
 * What this panel teaches:
 * - Heavy work in a panel: there are no workers in the sandbox, so the panel
 *   times each run and stops running live when a pattern turns slow, instead
 *   of freezing on every keystroke.
 * - Building text with DOM nodes, never innerHTML, so the person's text can
 *   hold anything.
 * - A whole form kept in one storage key, written after typing pauses. */

import { MAX_TEXT, compile, findMatches, nameGroups } from './regex.js'
import { debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'session'
const SLOW_MS = 150
const $ = (id) => document.getElementById(id)

const SAMPLE = {
  pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)',
  flags: 'g',
  text: 'Write to ada@example.com or grace.hopper@example.org.\nThe old address, alan@turing, no longer works.',
  replacement: '$<user> at $<domain>',
  mode: 'match',
}

let state = { ...SAMPLE }
let live = true

snapThemeChanges()
const init = await deska.ready()

try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved === 'object') state = { ...SAMPLE, ...pick(saved) }
} catch (err) {
  showStatus(problemText(err, 'load your last pattern'), 'error')
}
$('pattern').value = state.pattern
$('text').value = state.text
$('replacement').value = state.replacement
setFlags(state.flags)
setMode(state.mode)
$('app').setAttribute('aria-busy', 'false')
run()

function pick(saved) {
  const out = {}
  for (const k of ['pattern', 'flags', 'text', 'replacement']) if (typeof saved[k] === 'string') out[k] = saved[k]
  if (saved.mode === 'match' || saved.mode === 'replace') out.mode = saved.mode
  out.flags = (out.flags ?? 'g').replace(/[^gimsu]/g, '')
  return out
}

// Running ---------------------------------------------------------------------------

function run() {
  const text = $('text').value
  const { regex, error } = compile($('pattern').value, state.flags)
  $('pattern').setAttribute('aria-invalid', String(Boolean(error)))
  $('pattern-error').hidden = !error
  $('pattern-error').textContent = error || ''
  $('run').hidden = live

  if (text.length > MAX_TEXT) {
    $('count').textContent = ''
    renderPreview(text.slice(0, 2000), [])
    $('matches').replaceChildren()
    showStatus(`The test text is over ${MAX_TEXT.toLocaleString()} characters. Shorten it to test.`, 'error')
    return
  }
  if (error || !regex) {
    $('count').textContent = error ? 'Fix the pattern' : 'Write a pattern'
    renderPreview(text, [])
    $('matches').replaceChildren()
    deska.setTitle(init.panel.name).catch(() => {})
    return
  }

  const started = performance.now()
  const { matches, capped } = findMatches(regex, text)
  let output = null
  if (state.mode === 'replace') output = text.replace(regex, $('replacement').value)
  const took = performance.now() - started

  // A pattern that backtracks badly can take seconds. A panel runs in its own
  // process, so only this panel waits, but it would wait on every key. Past
  // SLOW_MS, stop running live and offer a Run button.
  if (took > SLOW_MS && live) {
    live = false
    $('run').hidden = false
    showStatus(`That took ${Math.round(took)} ms, so the panel stopped testing as you type. Press Run to test again.`, 'error')
  }

  const n = matches.length
  $('count').textContent =
    n === 0 ? 'No matches' : `${capped ? 'First ' : ''}${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}${!regex.global && n ? ', add g for all' : ''}`
  deska.setTitle(n === 0 ? 'No matches' : `${n} ${n === 1 ? 'match' : 'matches'}`).catch(() => {})

  if (output !== null) {
    renderPreview(output, [])
    $('preview').setAttribute('aria-label', 'Text after replacing')
  } else {
    renderPreview(text, matches)
    $('preview').setAttribute('aria-label', 'Text with matches marked')
  }
  renderList(matches, $('pattern').value)
}

function renderPreview(text, matches) {
  const nodes = []
  let at = 0
  matches.forEach((m, i) => {
    if (m.index > at) nodes.push(document.createTextNode(text.slice(at, m.index)))
    const mark = document.createElement('mark')
    mark.className = i % 2 ? 'alt' : ''
    // An empty match still gets a thin caret so you can see where it landed.
    if (m.text === '') mark.classList.add('empty')
    mark.textContent = m.text
    nodes.push(mark)
    at = m.index + m.text.length
  })
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)))
  if (!text) {
    const hint = document.createElement('span')
    hint.className = 'muted'
    hint.textContent = 'Paste or type some text to test against.'
    nodes.push(hint)
  }
  $('preview').replaceChildren(...nodes)
}

function renderList(matches, source) {
  const shown = matches.slice(0, 200)
  $('matches').replaceChildren(
    ...shown.map((m, i) => {
      const li = document.createElement('li')
      const head = document.createElement('div')
      head.className = 'match-head'
      const num = document.createElement('span')
      num.className = 'match-num'
      num.textContent = `${i + 1}`
      const value = document.createElement('code')
      value.className = 'match-text'
      value.textContent = m.text === '' ? '(empty)' : m.text
      const where = document.createElement('span')
      where.className = 'match-at'
      where.textContent = `at ${m.index}`
      head.append(num, value, where)
      li.append(head)
      const groups = nameGroups(source, m)
      if (groups.length) {
        const dl = document.createElement('dl')
        dl.className = 'groups'
        for (const g of groups) {
          const dt = document.createElement('dt')
          dt.textContent = g.name ? g.name : `$${g.number}`
          const dd = document.createElement('dd')
          dd.textContent = g.value === undefined ? '(no match)' : g.value
          if (g.value === undefined) dd.className = 'muted'
          dl.append(dt, dd)
        }
        li.append(dl)
      }
      return li
    }),
  )
}

const runSoon = debounce(() => live && run(), 120)
const save = debounce(async () => {
  state.pattern = $('pattern').value
  state.text = $('text').value.slice(0, MAX_TEXT)
  state.replacement = $('replacement').value
  try {
    await deska.storage.set(KEY, state)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 800)

for (const id of ['pattern', 'text', 'replacement']) {
  $(id).addEventListener('input', () => {
    runSoon()
    save()
  })
}

$('run').addEventListener('click', () => {
  // A manual run that comes back fast turns live testing on again.
  live = true
  showStatus('')
  run()
})

// Flags and mode ----------------------------------------------------------------------

function setFlags(flags) {
  state.flags = flags
  for (const b of document.querySelectorAll('[data-flag]')) b.setAttribute('aria-pressed', String(flags.includes(b.dataset.flag)))
}

for (const b of document.querySelectorAll('[data-flag]')) {
  b.addEventListener('click', () => {
    const f = b.dataset.flag
    setFlags(state.flags.includes(f) ? state.flags.replace(f, '') : state.flags + f)
    run()
    save()
  })
}

function setMode(mode) {
  state.mode = mode
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  $('replace-field').hidden = mode !== 'replace'
  $('matches').hidden = mode === 'replace'
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode)
    run()
    save()
  })
}

$('form').addEventListener('submit', (event) => {
  event.preventDefault()
  live = true
  run()
})
