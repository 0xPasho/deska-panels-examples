/* Sample Data: placeholder text, fake people and UUIDs, ready to paste.
 *
 * What this panel teaches:
 * - Seeded output: the seed is saved, so a reload shows the same data and
 *   Shuffle is just a new number.
 * - The 64 KB clipboard limit: the panel measures what it would copy and says
 *   so before Deska refuses it.
 * - A number field validated on change, with the error next to the field. */

import { asCsv, asJson, asMarkdown, people, text, uuids } from './generate.js'
import { copyText, debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'options'
const CLIPBOARD_MAX = 64 * 1024
const LIMITS = { text: { paragraphs: 50, sentences: 200, words: 2000 }, people: 500, uuids: 500 }
const DEFAULT_COUNT = { text: 3, people: 5, uuids: 5 }
const $ = (id) => document.getElementById(id)

let opts = { kind: 'text', count: { text: 3, people: 5, uuids: 5 }, unit: 'paragraphs', format: 'json', classic: true, seed: newSeed() }

function newSeed() {
  return Math.floor(Math.random() * 2 ** 31)
}

snapThemeChanges()
await deska.ready()
try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved === 'object') {
    if (['text', 'people', 'uuids'].includes(saved.kind)) opts.kind = saved.kind
    if (['paragraphs', 'sentences', 'words'].includes(saved.unit)) opts.unit = saved.unit
    if (['json', 'csv', 'markdown'].includes(saved.format)) opts.format = saved.format
    if (typeof saved.classic === 'boolean') opts.classic = saved.classic
    if (Number.isInteger(saved.seed)) opts.seed = saved.seed
    if (saved.count && typeof saved.count === 'object') {
      for (const k of ['text', 'people', 'uuids']) if (Number.isInteger(saved.count[k]) && saved.count[k] > 0) opts.count[k] = saved.count[k]
    }
  }
} catch (err) {
  showStatus(problemText(err, 'load your options'), 'error')
}
$('unit').value = opts.unit
$('format').value = opts.format
$('classic').checked = opts.classic
setKind(opts.kind)
$('app').setAttribute('aria-busy', 'false')

// Generating ------------------------------------------------------------------------

function limit() {
  return opts.kind === 'text' ? LIMITS.text[opts.unit] : LIMITS[opts.kind]
}

function generate() {
  const count = Math.min(opts.count[opts.kind], limit())
  let out
  if (opts.kind === 'text') out = text(opts.seed, opts.unit, count, opts.classic)
  else if (opts.kind === 'uuids') out = uuids(opts.seed, count).join('\n')
  else {
    const rows = people(opts.seed, count)
    out = opts.format === 'csv' ? asCsv(rows) : opts.format === 'markdown' ? asMarkdown(rows) : asJson(rows)
  }
  $('output').value = out
  $('output').classList.toggle('mono', opts.kind !== 'text')
  $('output').scrollTop = 0
  const bytes = new Blob([out]).size
  const tooBig = bytes > CLIPBOARD_MAX
  $('size').textContent = tooBig ? `${formatBytes(bytes)}, over the 64 KB Deska copies` : formatBytes(bytes)
  $('size').classList.toggle('is-error', tooBig)
}

function formatBytes(n) {
  return n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`
}

// Options ---------------------------------------------------------------------------

function setKind(kind) {
  opts.kind = kind
  for (const b of document.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === kind))
  for (const el of document.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== kind
  $('count').value = String(opts.count[kind] ?? DEFAULT_COUNT[kind])
  $('count').max = String(limit())
  clearCountError()
  generate()
}

for (const b of document.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => {
    setKind(b.dataset.kind)
    save()
  })
}

function clearCountError() {
  $('count-error').hidden = true
  $('count').removeAttribute('aria-invalid')
  $('count').removeAttribute('aria-describedby')
}

function readCount() {
  const n = Number($('count').value)
  const max = limit()
  if (!Number.isInteger(n) || n < 1 || n > max) {
    $('count-error').textContent = `Choose a whole number from 1 to ${max}.`
    $('count-error').hidden = false
    $('count').setAttribute('aria-invalid', 'true')
    $('count').setAttribute('aria-describedby', 'count-error')
    return
  }
  clearCountError()
  opts.count[opts.kind] = n
  generate()
  save()
}

$('count').addEventListener('input', debounce(readCount, 300))
$('count').addEventListener('change', readCount)
$('unit').addEventListener('change', () => {
  opts.unit = $('unit').value
  $('count').max = String(limit())
  readCount()
})
$('format').addEventListener('change', () => {
  opts.format = $('format').value
  generate()
  save()
})
$('classic').addEventListener('change', () => {
  opts.classic = $('classic').checked
  generate()
  save()
})
$('shuffle').addEventListener('click', () => {
  opts.seed = newSeed()
  generate()
  save()
})
$('form').addEventListener('submit', (event) => {
  event.preventDefault()
  readCount()
})

// Copy and save ---------------------------------------------------------------------

$('copy').addEventListener('click', async () => {
  const out = $('output').value
  if (new Blob([out]).size > CLIPBOARD_MAX) {
    showStatus('That is over the 64 KB Deska copies at once. Ask for fewer, or select part of it and copy with the keyboard.', 'error')
    return
  }
  const problem = await copyText(out)
  showStatus(problem || 'Copied', problem ? 'error' : 'ok')
})

const save = debounce(async () => {
  try {
    await deska.storage.set(KEY, opts)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 500)
