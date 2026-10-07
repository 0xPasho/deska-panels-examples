// Compiling and running a pattern, with no DOM and no bridge here.

export const MAX_TEXT = 100_000
export const MAX_MATCHES = 1000

/** { regex } or { error } with the engine's own message, tidied. */
export function compile(source, flags) {
  if (!source) return { regex: null }
  try {
    return { regex: new RegExp(source, flags) }
  } catch (err) {
    // "Invalid regular expression: /(/: Unterminated group" reads better as
    // just its last part.
    const message = String(err.message || err).replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '')
    return { error: message.charAt(0).toUpperCase() + message.slice(1) }
  }
}

/** Every match (or the first, without g), stopping at MAX_MATCHES. An empty
 *  match moves on by one character so the loop always ends. */
export function findMatches(regex, text) {
  const matches = []
  if (!regex.global) {
    const m = regex.exec(text)
    if (m) matches.push(shape(m))
    return { matches, capped: false }
  }
  regex.lastIndex = 0
  let m
  while ((m = regex.exec(text))) {
    matches.push(shape(m))
    if (m[0] === '') regex.lastIndex += regex.unicode && text.codePointAt(m.index) > 0xffff ? 2 : 1
    if (matches.length >= MAX_MATCHES) return { matches, capped: true }
  }
  return { matches, capped: false }
}

function shape(m) {
  return {
    index: m.index,
    text: m[0],
    groups: m.slice(1).map((value, i) => ({ name: null, number: i + 1, value })),
    named: m.groups ? { ...m.groups } : null,
  }
}

/** Gives numbered groups their names where the pattern named them. */
export function nameGroups(source, match) {
  if (!match.named) return match.groups
  // Named and unnamed groups share one numbering, left to right by "(".
  const names = []
  const re = /\\.|\[(?:\\.|[^\]])*\]|\((\?<([A-Za-z_$][\w$]*)>|\?[:=!]|\?<[=!])?/g
  let t
  while ((t = re.exec(source))) {
    if (t[0][0] !== '(') continue
    if (t[2]) names.push(t[2])
    else if (!t[1]) names.push(null)
  }
  return match.groups.map((g, i) => ({ ...g, name: names[i] ?? null }))
}
