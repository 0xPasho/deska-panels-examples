// Runs one bridge call and shows, in the section's output block, the line of
// code it ran, what came back, and what an error code means.

import { ERROR_MEANINGS, codeOf } from './errors.js'

const LONG_TEXT = 120

/**
 * @param {HTMLElement} out  a `.out` block (see index.html)
 * @param {string} line      the code to show, as a creator would write it
 * @param {() => Promise<unknown>} call
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, code: string }>}
 */
export async function run(out, line, call) {
  const el = partsOf(out)
  el.line.textContent = line
  show(el, 'pending', document.createTextNode('Waiting for an answer'))
  try {
    const value = await call()
    if (value === null || value === undefined) {
      show(el, 'ok', document.createTextNode('Resolved with null'))
    } else {
      show(el, 'ok', document.createTextNode('Resolved'))
      el.value.textContent = JSON.stringify(value, null, 2)
      el.value.hidden = false
    }
    return { ok: true, value }
  } catch (err) {
    const code = codeOf(err)
    showError(el, code)
    return { ok: false, code }
  }
}

/** Shows a code the page caught before calling, like JSON that does not parse. */
export function showLocalError(out, line, message) {
  const el = partsOf(out)
  el.line.textContent = line
  show(el, 'error', document.createTextNode(message))
}

/** Replaces the meaning line, for sections that know more (a countdown). */
export function setMeaning(out, text) {
  const { meaning } = partsOf(out)
  meaning.lastChild.textContent = ` ${text}`
}

const RAW = Symbol('raw')

/** Marks code to print as is inside literal(), like Date.now() + 60_000. */
export function raw(code) {
  return { [RAW]: code }
}

/** Renders a value as a JavaScript literal, so the shown line reads like code. */
export function literal(value) {
  if (value?.[RAW]) return value[RAW]
  if (typeof value === 'string') {
    const text = value.length > LONG_TEXT ? `${value.slice(0, LONG_TEXT)}…` : value
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
  }
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, v]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : literal(key)}: ${literal(v)}`)
    return entries.length ? `{ ${entries.join(', ')} }` : '{}'
  }
  return String(value)
}

function partsOf(out) {
  return {
    line: out.querySelector('.line'),
    status: out.querySelector('.status'),
    value: out.querySelector('.value'),
    meaning: out.querySelector('.meaning'),
  }
}

function show(el, kind, content) {
  el.status.dataset.kind = kind
  el.status.replaceChildren(content)
  el.status.hidden = false
  el.value.hidden = true
  el.meaning.hidden = true
}

function showError(el, code) {
  const name = document.createElement('code')
  name.textContent = code
  show(el, 'error', document.createTextNode('Rejected with '))
  el.status.append(name)

  const label = document.createElement('span')
  label.className = 'meaning-label'
  label.textContent = 'What this error means.'
  el.meaning.replaceChildren(label, document.createTextNode(` ${ERROR_MEANINGS[code]}`))
  el.meaning.hidden = false
}
