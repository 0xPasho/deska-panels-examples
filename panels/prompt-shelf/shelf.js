// The shelf's saved shape and its placeholders. Pure functions, no SDK calls,
// so the rules stay easy to read and to test on their own.
//
// Saved under one storage key as { version: 1, items: [...] }. The version
// number is what lets a later release of this panel read what an older one
// wrote: bump it when the shape changes and teach readShelf the old one.

export const SHELF_VERSION = 1

export const SEED = [
  {
    title: 'Review this diff for bugs',
    text:
      'Review the changes on this branch against {{base branch}} for bugs, not style. ' +
      'For each problem give the file and line, what goes wrong and the smallest fix. ' +
      'If you find nothing, say so plainly instead of inventing issues.',
  },
  {
    title: 'Write tests first',
    text:
      'Before changing any code for {{feature}}, write failing tests that describe the behavior we want. ' +
      'Run them and show me they fail for the right reason. ' +
      'Then make them pass with the smallest change and run the whole suite.',
  },
  {
    title: 'Explain this error',
    text:
      'Explain this error in plain words: what it means, the most likely cause in this codebase, ' +
      'and how to confirm that cause before changing anything.\n\n{{error}}',
  },
  {
    title: 'Plan before coding',
    text:
      'Do not write code yet. Read the files involved, then give me a short plan: ' +
      'which files you will change, what changes in each, and what could break. ' +
      'Wait for my go ahead before you start.',
  },
]

/** A fresh shelf holding the seed prompts, for the very first run. */
export function seedShelf() {
  return { version: SHELF_VERSION, items: SEED.map((p) => makeItem(p.title, p.text)) }
}

export function makeItem(title, text) {
  return { id: newId(), title, text, updatedAt: Date.now() }
}

function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Turns whatever storage held into a shelf, or explains why it cannot.
 * Returns { shelf } or { problem }. Never throws on bad data: storage is
 * shared by every copy of the package, so treat it like input.
 */
export function readShelf(raw) {
  if (raw === null || raw === undefined) return { shelf: seedShelf(), fresh: true }
  if (typeof raw !== 'object' || !Array.isArray(raw.items)) return { problem: 'The saved shelf is damaged.' }
  if (raw.version > SHELF_VERSION) return { problem: 'These prompts were saved by a newer version of this panel. Update it to read them.' }
  if (raw.version !== SHELF_VERSION) return { problem: 'The saved shelf has an unknown format.' }
  const items = raw.items
    .filter((i) => i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.text === 'string')
    .map((i) => ({ id: i.id, title: i.title, text: i.text, updatedAt: Number(i.updatedAt) || 0 }))
  return { shelf: { version: SHELF_VERSION, items } }
}

// {{ name }}: letters, digits, spaces, dots, dashes and underscores, up to 40.
const PLACEHOLDER = /\{\{\s*([\w .-]{1,40}?)\s*\}\}/g

/** The distinct placeholder names in a prompt, in the order they appear. */
export function placeholders(text) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

/** Fills every placeholder that has a value; empty ones stay as written. */
export function fill(text, values) {
  return text.replace(PLACEHOLDER, (whole, name) => (values[name] ? values[name] : whole))
}

/** Splits a prompt into plain and placeholder parts, for the row preview. */
export function parts(text) {
  const out = []
  let last = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[1], placeholder: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export function matches(item, query) {
  if (!query) return true
  const q = query.toLowerCase()
  return item.title.toLowerCase().includes(q) || item.text.toLowerCase().includes(q)
}
