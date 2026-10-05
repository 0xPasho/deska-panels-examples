// Theme Inspector: shows every theme token Deska sends a panel, live. Each
// token's swatch, name and resolved value; the mode; the contrast of every
// text color on the two grounds; and a small sample drawn only from tokens.
// Click a token to copy its var(), or copy them all as a :root block.
//
// What this panel teaches:
// - deska.theme and deska.on('theme', fn): the mode and the resolved tokens,
//   first in the init payload, then again on every theme or accent change.
// - The SDK already writes the tokens as CSS custom properties on <html> and
//   sets color-scheme, so app.css only ever says var(--deska-…).
// - Tokens are solid colors, so contrast is computed from the values alone.
// - deska.clipboard.write, and what each of its error codes means.
// - deska.storage, to come back to the same view after a reload.

import { parseColor, contrastRatio, luminance, verdict } from './color.js'

const COLORS = [
  ['--deska-bg', 'The panel ground'],
  ['--deska-surface', 'Cards and inputs'],
  ['--deska-surface-raised', 'Hover and raised rows'],
  ['--deska-text', 'Body text'],
  ['--deska-text-secondary', 'Supporting text'],
  ['--deska-text-tertiary', 'Hints and quiet labels'],
  ['--deska-accent', 'The one commit action'],
  ['--deska-on-accent', 'Text on the accent'],
  ['--deska-border', 'Dividers and outlines'],
  ['--deska-focus', 'Focus rings'],
  ['--deska-danger', 'Errors and destructive actions'],
  ['--deska-success', 'Done and healthy'],
]
const FONTS = ['--deska-font-ui', '--deska-font-mono']
const RADII = ['--deska-radius', '--deska-radius-small']
const TEXT_TOKENS = ['--deska-text', '--deska-text-secondary', '--deska-text-tertiary', '--deska-accent', '--deska-danger', '--deska-success']
const VIEWS = ['tokens', 'contrast', 'specimen']
const VIEW_KEY = 'view'
const NOTICE_MS = 2400

const $ = (id) => document.getElementById(id)
let theme = null
let noticeTimer = null

main()

async function main() {
  wireTabs()
  wireActions()
  showWaitingHintLater()

  // ready() resolves with the init payload. Its theme is also on deska.theme,
  // and the SDK has already applied it to <html> by the time this resolves.
  const init = await deska.ready()
  render(init.theme || deska.theme)

  // Deska sends 'theme' whenever the person switches theme or accent. The SDK
  // updates the CSS variables itself; we only redraw what shows values.
  deska.on('theme', (next) => {
    withoutTransitions(() => render(next))
  })

  // The view the person last looked at survives a reload (moving the panel
  // to a dock reloads it). Storage is the only place that persists: the
  // frame's origin is opaque, so localStorage throws.
  try {
    const saved = await deska.storage.get(VIEW_KEY)
    showView(VIEWS.includes(saved) ? saved : 'tokens')
  } catch (err) {
    showView('tokens')
    showNotice(`Couldn't load the last view (${err.code || err.message}).`, 'error')
  }
  $('app').removeAttribute('aria-busy')
}

// Outside Deska, ready() never resolves. Say so instead of waiting forever.
function showWaitingHintLater() {
  setTimeout(() => {
    if (theme) return
    $('mode-detail').textContent = 'Open this page inside Deska to see its theme.'
  }, 3000)
}

// --- rendering ---------------------------------------------------------------

function render(next) {
  const tokens = next && typeof next.tokens === 'object' && next.tokens ? next.tokens : {}
  theme = { mode: next?.mode === 'light' ? 'light' : 'dark', tokens }
  const sent = Object.keys(tokens).filter((name) => name.startsWith('--deska-'))

  renderMode()
  $('copy-css').disabled = sent.length === 0
  $('empty').hidden = sent.length > 0
  $('empty').textContent = 'Deska sent no theme tokens. Switch the theme in Deska to send them again.'
  renderColors()
  renderFonts()
  renderRadii()
  renderContrast()
}

function renderMode() {
  const bg = parseColor(theme.tokens['--deska-bg'])
  $('mode-name').textContent = theme.mode === 'light' ? 'Light mode' : 'Dark mode'
  // Deska calls a theme light when the ground's luminance is above 0.18.
  $('mode-detail').textContent = bg ? `Background luminance ${luminance(bg).toFixed(3)}` : 'Background not sent'
}

function renderColors() {
  $('list-colors').replaceChildren(
    ...COLORS.map(([name, role]) => {
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = `var(${name})`
      return tokenRow(name, role, swatch)
    }),
  )
}

function renderFonts() {
  $('list-fonts').replaceChildren(
    ...FONTS.map((name) => {
      const sample = document.createElement('span')
      sample.className = 'font-sample'
      sample.style.fontFamily = `var(${name})`
      sample.textContent = 'Aa'
      sample.setAttribute('aria-hidden', 'true')
      return tokenRow(name, null, sample)
    }),
  )
}

function renderRadii() {
  $('list-radii').replaceChildren(
    ...RADII.map((name) => {
      const corner = document.createElement('span')
      corner.className = 'corner'
      corner.style.borderTopLeftRadius = `var(${name})`
      return tokenRow(name, null, corner)
    }),
  )
}

function tokenRow(name, role, preview) {
  const value = theme.tokens[name]
  const li = document.createElement('li')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'token'
  button.dataset.token = name
  button.setAttribute('aria-label', `Copy var(${name}), ${value ?? 'not sent'}`)
  preview.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = 'token-label'
  const code = document.createElement('code')
  code.className = 'token-name'
  code.textContent = name
  label.append(code)
  if (role) {
    const small = document.createElement('span')
    small.className = 'token-role'
    small.textContent = role
    label.append(small)
  }

  const shown = document.createElement('code')
  shown.className = value === undefined ? 'token-value missing' : 'token-value'
  shown.textContent = value ?? 'Not sent'
  shown.title = value ?? ''

  button.append(preview, label, shown)
  li.append(button)
  return li
}

function renderContrast() {
  const grounds = ['--deska-bg', '--deska-surface'].map((name) => parseColor(theme.tokens[name]))
  $('contrast-rows').replaceChildren(
    ...TEXT_TOKENS.map((name) => {
      const color = parseColor(theme.tokens[name])
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.scope = 'row'
      const sample = document.createElement('code')
      sample.className = 'contrast-name'
      sample.style.color = `var(${name})`
      sample.textContent = name.replace('--deska-', '')
      th.append(sample)
      tr.append(th, ...grounds.map((ground) => contrastCell(color, ground)))
      return tr
    }),
    onAccentRow(),
  )
}

// on-accent is only ever drawn on the accent, so measure it there.
function onAccentRow() {
  const tr = document.createElement('tr')
  const th = document.createElement('th')
  th.scope = 'row'
  const name = document.createElement('code')
  name.className = 'contrast-name'
  name.textContent = 'on-accent'
  const where = document.createElement('span')
  where.className = 'contrast-where'
  where.textContent = 'On the accent'
  th.append(name, where)
  const cell = contrastCell(parseColor(theme.tokens['--deska-on-accent']), parseColor(theme.tokens['--deska-accent']))
  cell.colSpan = 2
  tr.append(th, cell)
  return tr
}

function contrastCell(text, ground) {
  const td = document.createElement('td')
  if (!text || !ground) {
    td.textContent = 'Can\'t measure'
    td.className = 'missing'
    return td
  }
  const ratio = contrastRatio(text, ground)
  const { word, level } = verdict(ratio)
  const number = document.createElement('span')
  number.className = 'ratio'
  number.textContent = ratio.toFixed(1)
  const label = document.createElement('span')
  label.className = `verdict ${level}`
  label.textContent = word
  td.append(number, label)
  return td
}

// A theme switch changes color on almost every element at once; letting the
// hover transitions run would smear it. Turn them off for one frame.
function withoutTransitions(fn) {
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.append(style)
  fn()
  void document.body.offsetHeight
  requestAnimationFrame(() => style.remove())
}

// --- tabs ------------------------------------------------------------------

function wireTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      showView(tab.dataset.view)
      saveView(tab.dataset.view)
    })
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
      if (!step) return
      event.preventDefault()
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
      // Moving focus here answers the person's own key press, which is allowed.
      next.focus()
      next.click()
    })
  }
}

function showView(view) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.view === view
    tab.setAttribute('aria-selected', String(on))
    tab.tabIndex = on ? 0 : -1
    $(`view-${tab.dataset.view}`).hidden = !on
  }
  $('scroll').scrollTop = 0
}

async function saveView(view) {
  try {
    await deska.storage.set(VIEW_KEY, view)
  } catch (err) {
    // storage_full is the one a person can act on; the rest are rare.
    const code = err.code || err.message
    showNotice(code === 'storage_full' ? 'Storage is full, so this view won\'t be remembered.' : `Couldn't remember this view (${code}).`, 'error')
  }
}

// --- copying -----------------------------------------------------------------

function wireActions() {
  $('view-tokens').addEventListener('click', (event) => {
    const button = event.target.closest('.token')
    if (button) copy(`var(${button.dataset.token})`, `Copied var(${button.dataset.token})`)
  })
  $('copy-css').addEventListener('click', () => copy(rootBlock(), 'Copied a :root block with every token'))
  // The sample form is only a sample. form-action is 'none' in a panel, so
  // every form must stop its own submit anyway.
  $('specimen-form').addEventListener('submit', (event) => event.preventDefault())
}

function rootBlock() {
  const lines = Object.entries(theme.tokens)
    .filter(([name]) => name.startsWith('--deska-'))
    .map(([name, value]) => `  ${name}: ${value};`)
  return `:root {\n  color-scheme: ${theme.mode};\n${lines.join('\n')}\n}\n`
}

// clipboard.write needs the clipboard-write permission and the frame to have
// focus, which a click inside the panel gives it. Each refusal has a code.
async function copy(text, done) {
  try {
    await deska.clipboard.write(text)
    showNotice(done)
  } catch (err) {
    showNotice(copyError(err.code || err.message), 'error')
  }
}

function copyError(code) {
  switch (code) {
    case 'not_focused':
      return 'Click inside the panel, then copy again.'
    case 'permission_denied':
      return 'This panel isn\'t allowed to use the clipboard.'
    case 'rate_limited':
      return 'Too many copies at once. Try again in a moment.'
    case 'too_large':
      return 'That is too much text to copy.'
    default:
      return `Couldn't copy (${code}). Try again.`
  }
}

function showNotice(text, kind = 'info') {
  const notice = $('notice')
  notice.textContent = text
  notice.dataset.kind = kind
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.textContent = ''), NOTICE_MS)
}
