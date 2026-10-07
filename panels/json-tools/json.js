// Parsing with a useful error, formatting, and a structural diff. No DOM.

/** { value } or { error, line, column, offset } for text that is not JSON. */
export function parse(text) {
  if (!text.trim()) return { empty: true }
  try {
    return { value: JSON.parse(text) }
  } catch (err) {
    // JSON.parse's messages differ between engines and versions, and some
    // carry no position. A small scanner finds the spot and says why.
    const found = locate(text)
    if (!found) return { error: String(err.message || err), offset: null }
    return { error: found.reason, offset: found.offset, ...lineColumn(text, found.offset) }
  }
}

/** Walks the text by JSON's grammar and returns { offset, reason } at the
 *  first thing that breaks it, or null when it finds nothing wrong. */
export function locate(text) {
  let i = 0
  const fail = (reason, at = i) => {
    throw { offset: Math.min(at, text.length), reason }
  }
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const describe = (ch) => (ch === undefined ? 'the end of the text' : `"${ch}"`)
  const value = () => {
    ws()
    const ch = text[i]
    if (ch === '{') return object()
    if (ch === '[') return array()
    if (ch === '"') return string()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return number()
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length
        return
      }
    }
    if (ch === "'") fail('Strings need double quotes, not single quotes')
    if (ch === undefined) fail('The JSON ends where a value should be')
    fail(`Expected a value, found ${describe(ch)}`)
  }
  const object = () => {
    i++
    ws()
    if (text[i] === '}') return i++
    for (;;) {
      ws()
      if (text[i] === '}') fail('Remove the comma before }: JSON allows no trailing comma')
      if (text[i] !== '"') fail(text[i] === undefined ? 'The JSON ends inside an object: a } is missing' : `Property names need double quotes, found ${describe(text[i])}`)
      string()
      ws()
      if (text[i] !== ':') fail(`Expected a colon after the property name, found ${describe(text[i])}`)
      i++
      value()
      ws()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '}') return i++
      fail(text[i] === undefined ? 'The JSON ends inside an object: a } is missing' : `Expected a comma or }, found ${describe(text[i])}`)
    }
  }
  const array = () => {
    i++
    ws()
    if (text[i] === ']') return i++
    for (;;) {
      ws()
      if (text[i] === ']') fail('Remove the comma before ]: JSON allows no trailing comma')
      value()
      ws()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === ']') return i++
      fail(text[i] === undefined ? 'The JSON ends inside a list: a ] is missing' : `Expected a comma or ], found ${describe(text[i])}`)
    }
  }
  const string = () => {
    const start = i
    i++
    while (i < text.length) {
      const ch = text[i]
      if (ch === '"') return i++
      if (ch === '\\') {
        const next = text[i + 1]
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('A \\u escape needs four hex digits')
          i += 6
        } else if ('"\\/bfnrt'.includes(next) && next !== undefined) i += 2
        else fail(`"\\${next ?? ''}" is not an escape JSON knows`)
        continue
      }
      if (ch < ' ') fail(ch === '\n' ? 'A string cannot span lines: close it with " or write \\n' : 'A string holds a control character: escape it')
      i++
    }
    fail('This string is never closed: a " is missing', start)
  }
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m || m[0] === '-') fail('This number is not valid JSON')
    if (m[1] === '0' && /\d/.test(text[i + m[0].length] ?? '')) fail('Numbers cannot start with 0', i + m[0].length)
    i += m[0].length
  }
  try {
    value()
    ws()
    if (i < text.length) fail(`Unexpected ${describe(text[i])} after the JSON ended`)
    return null
  } catch (found) {
    if (found && typeof found.offset === 'number') return found
    // Nesting deeper than the call stack: no position to point at.
    if (found instanceof RangeError) return null
    throw found
  }
}

export function lineColumn(text, offset) {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - before.lastIndexOf('\n')
  return { line, column }
}

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, sortKeys(value[k])]),
    )
  }
  return value
}

export function format(value, indent, sort) {
  const v = sort ? sortKeys(value) : value
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : Number(indent))
}

export function describe(value) {
  if (Array.isArray(value)) return `an array of ${value.length} ${value.length === 1 ? 'item' : 'items'}`
  if (value === null) return 'null'
  if (typeof value === 'object') {
    const n = Object.keys(value).length
    return `an object with ${n} ${n === 1 ? 'key' : 'keys'}`
  }
  return `a ${typeof value}`
}

const MAX_DIFFS = 500

/** Differences from a to b as { path, kind, before, after }. Arrays compare
 *  item by item at the same index; objects key by key. */
export function diff(a, b) {
  const out = []
  walk(a, b, '', out)
  return { changes: out.slice(0, MAX_DIFFS), capped: out.length > MAX_DIFFS }
}

function walk(a, b, path, out) {
  if (out.length > MAX_DIFFS) return
  if (Object.is(a, b)) return
  const ta = kind(a)
  const tb = kind(b)
  if (ta !== tb || (ta !== 'object' && ta !== 'array')) {
    out.push({ path: path || '(root)', kind: 'changed', before: a, after: b })
    return
  }
  if (ta === 'array') {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`
      if (i >= a.length) out.push({ path: p, kind: 'added', after: b[i] })
      else if (i >= b.length) out.push({ path: p, kind: 'removed', before: a[i] })
      else walk(a[i], b[i], p, out)
    }
    return
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const p = path + keyPath(k)
    if (!(k in b)) out.push({ path: p, kind: 'removed', before: a[k] })
    else if (!(k in a)) out.push({ path: p, kind: 'added', after: b[k] })
    else walk(a[k], b[k], p, out)
  }
}

function kind(v) {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

const keyPath = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)

/** A value in one short line, for the diff list. */
export function short(value, max = 60) {
  const text = JSON.stringify(value)
  if (text === undefined) return 'undefined'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
