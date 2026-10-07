/* Contrast Checker: a text and background color against WCAG 2 levels, and
 * the nearest text color that passes.
 *
 * What this panel teaches:
 * - Showing the person's colors without breaking the theme: only the sample
 *   box takes their colors; everything around it stays on Deska's tokens.
 * - Status that does not lean on color: every level says Pass or Fail in
 *   words, with an icon, not just green or red.
 * - Small state in storage: the last pair comes back after a reload. */

import { contrast, formatRatio, nearestPassing, over, parseColor, toHex } from './color.js'
import { debounce, problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'pair'
const $ = (id) => document.getElementById(id)
let pair = { fg: '#6b7280', bg: '#ffffff' }
let suggestion = null

snapThemeChanges()
await deska.ready()
try {
  const saved = await deska.storage.get(KEY)
  if (saved && typeof saved.fg === 'string' && typeof saved.bg === 'string') pair = { fg: saved.fg, bg: saved.bg }
} catch (err) {
  showStatus(problemText(err, 'load your last colors'), 'error')
}
$('fg').value = pair.fg
$('bg').value = pair.bg
$('app').setAttribute('aria-busy', 'false')
update()

function read(id, label) {
  const color = parseColor($(id).value)
  const error = $(`${id}-error`)
  const bad = !color
  $(id).setAttribute('aria-invalid', String(bad))
  error.hidden = !bad
  error.textContent = bad ? `${label} is not a color. Try #1f2937, rgb(31 41 55) or a name like navy.` : ''
  if (color) $(`${id}-pick`).value = toHex(color.a < 1 ? over(color, { r: 255, g: 255, b: 255, a: 1 }) : color)
  return color
}

function update() {
  const fgRaw = read('fg', 'Text')
  const bgRaw = read('bg', 'Background')
  const levels = document.querySelectorAll('.levels li')
  if (!fgRaw || !bgRaw) {
    $('ratio').textContent = 'Check the colors'
    $('verdict').textContent = ''
    for (const li of levels) setLevel(li, null)
    $('fix').hidden = true
    return
  }
  // A background with transparency would show whatever is behind it; measure
  // it over white and say so.
  const bg = bgRaw.a < 1 ? over(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw
  const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw
  const ratio = contrast(fg, bg)

  const sample = $('sample')
  sample.style.color = toHex(fg)
  sample.style.backgroundColor = toHex(bg)

  $('ratio').textContent = formatRatio(ratio)
  $('verdict').textContent = ratio >= 7 ? 'Passes every level' : ratio >= 4.5 ? 'Passes AA' : ratio >= 3 ? 'Large text only' : 'Fails every level'
  for (const li of levels) setLevel(li, ratio)

  suggestion = ratio < 4.5 ? nearestPassing(fg, bg, 4.5) : null
  $('fix').hidden = !suggestion
  if (suggestion) {
    $('fix-color').textContent = toHex(suggestion)
    $('fix-chip').style.backgroundColor = toHex(suggestion)
  }
  if (bgRaw.a < 1) showStatus('The background is translucent, so it is measured over white.')
  deska.setTitle(`${formatRatio(ratio)} ${ratio >= 4.5 ? 'passes AA' : 'fails AA'}`).catch(() => {})
}

function setLevel(li, ratio) {
  const badge = li.querySelector('.badge')
  if (ratio === null) {
    li.className = ''
    badge.textContent = ''
    return
  }
  const pass = ratio >= Number(li.dataset.min)
  li.className = pass ? 'pass' : 'fail'
  badge.textContent = pass ? 'Pass' : 'Fail'
}

const save = debounce(async () => {
  pair = { fg: $('fg').value.trim(), bg: $('bg').value.trim() }
  try {
    await deska.storage.set(KEY, pair)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
}, 600)

const updateSoon = debounce(update, 120)
for (const id of ['fg', 'bg']) {
  $(id).addEventListener('input', () => {
    updateSoon()
    save()
  })
  // The native picker writes hex into the text field.
  $(`${id}-pick`).addEventListener('input', () => {
    $(id).value = $(`${id}-pick`).value
    update()
    save()
  })
}

$('swap').addEventListener('click', () => {
  ;[$('fg').value, $('bg').value] = [$('bg').value, $('fg').value]
  update()
  save()
})

$('fix-use').addEventListener('click', () => {
  if (!suggestion) return
  $('fg').value = toHex(suggestion)
  update()
  save()
  showStatus('Text color updated', 'ok')
  $('fg').focus()
})

$('colors').addEventListener('submit', (event) => event.preventDefault())
