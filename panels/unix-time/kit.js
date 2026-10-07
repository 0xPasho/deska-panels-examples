// Small helpers this panel shares with its siblings in the repo. Each package
// ships its own copy: a panel is a standalone folder, so nothing is shared at
// runtime.

/** A theme change repaints every color at once: switch transitions off for a
 *  frame so the flip snaps instead of smearing. */
export function snapThemeChanges() {
  deska.on('theme', () => {
    document.documentElement.classList.add('no-transitions')
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('no-transitions')))
  })
}

/** Turns a bridge error code into a sentence a person can act on. */
export function problemText(err, action = 'do that') {
  const code = err && err.code
  const messages = {
    not_focused: `Click the panel first, then ${action} again.`,
    too_large: 'That is over the 64 KB Deska copies at once.',
    permission_denied: 'This panel was not allowed to do that. Check its permissions in the Panel Library.',
    rate_limited: 'Too many requests at once. Try again in a moment.',
    storage_full: 'Storage is full. Remove something and try again.',
  }
  return messages[code] || `Could not ${action} (${code || 'unknown error'}).`
}

/** Copies text through Deska. Resolves to null when it worked, or to the
 *  sentence to show when it did not. Call it straight from a click or a key:
 *  Deska only copies while the panel has focus. */
export async function copyText(text) {
  try {
    await deska.clipboard.write(text)
    return null
  } catch (err) {
    return problemText(err, 'copy')
  }
}

export function debounce(fn, ms) {
  let timer = null
  const run = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  run.flush = (...args) => {
    clearTimeout(timer)
    fn(...args)
  }
  return run
}

/** Shows a short message in the panel's status line; ok or error tint it.
 *  Messages that are not errors clear themselves. */
let statusTimer = null
export function showStatus(text, kind = '') {
  const el = document.getElementById('status')
  if (!el) return
  clearTimeout(statusTimer)
  el.textContent = text
  el.className = `status${kind ? ` is-${kind}` : ''}`
  if (text && kind !== 'error') statusTimer = setTimeout(() => showStatus(''), 2400)
}
