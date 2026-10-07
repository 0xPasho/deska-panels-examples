// The notes document and the Markdown it copies. No bridge calls here, so
// this file reads (and tests) on its own.

export const VERSION = 1
export const KEEP_DAYS = 60
export const FIELDS = ['yesterday', 'today', 'blockers']

/** 'YYYY-MM-DD' for a Date, in the person's own time zone. */
export function dayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function shiftDay(key, days) {
  const date = dateOf(key)
  date.setDate(date.getDate() + days)
  return dayKey(date)
}

export function emptyDoc() {
  return { version: VERSION, days: {} }
}

/** Reads what storage held. Returns { doc } or { newer: true } when a later
 *  version of the panel wrote it: then the panel must not overwrite it. */
export function readDoc(saved) {
  if (saved == null) return { doc: emptyDoc() }
  if (typeof saved !== 'object' || typeof saved.version !== 'number') return { doc: emptyDoc() }
  if (saved.version > VERSION) return { newer: true }
  const days = {}
  for (const [key, note] of Object.entries(saved.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !note || typeof note !== 'object') continue
    days[key] = Object.fromEntries(FIELDS.map((f) => [f, typeof note[f] === 'string' ? note[f] : '']))
  }
  return { doc: { version: VERSION, days } }
}

export const isEmpty = (note) => !note || FIELDS.every((f) => !note[f].trim())

/** Drops empty days and days older than KEEP_DAYS, so storage stays small. */
export function compact(doc, todayKey) {
  const oldest = shiftDay(todayKey, -KEEP_DAYS)
  const days = {}
  for (const [key, note] of Object.entries(doc.days)) if (key >= oldest && !isEmpty(note)) days[key] = note
  return { version: VERSION, days }
}

/** The most recent day before `key` that has a plan for its Today. */
export function previousPlan(doc, key) {
  const earlier = Object.keys(doc.days).filter((k) => k < key && doc.days[k].today.trim()).sort()
  const last = earlier.at(-1)
  return last ? { key: last, text: doc.days[last].today } : null
}

/** Lines become bullets. A line that already starts with -, * or a number
 *  keeps its own marker; blank lines are dropped. */
export function bullets(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => (/^\s*([-*+]|\d+[.)])\s/.test(line) ? line : `- ${line.trim()}`))
}

export function toMarkdown(note, label) {
  const part = (title, text, fallback) => {
    const lines = bullets(text)
    return [`**${title}**`, ...(lines.length ? lines : [`- ${fallback}`])].join('\n')
  }
  return [
    `**Standup, ${label}**`,
    part('Yesterday', note.yesterday, 'Nothing noted'),
    part('Today', note.today, 'Nothing planned yet'),
    part('Blockers', note.blockers, 'None'),
  ].join('\n\n')
}
