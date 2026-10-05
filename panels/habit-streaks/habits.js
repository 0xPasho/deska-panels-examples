// The habits document and everything that reads or reshapes it. No SDK calls
// here: these are plain functions over a plain object, so the storage rules
// (versioning, migration, compaction) stay easy to read and to test.
//
// The document, version 2:
//   {
//     version: 2,
//     since: '2025-09-01' | null,     // older days were folded into `before`
//     habits: [{ id, name, archived, before: { run, best } }],
//     days: { '2026-10-05': ['h1', 'h3'], ... }   // the habits done that day
//   }

export const VERSION = 2

// History kept day by day. A year of three habits is about 15 KB, far under
// the 256 KB a package gets. Older days still count toward streaks through
// each habit's `before` totals, so folding them away loses nothing visible.
export const KEEP_DAYS = 400

// What to fall back to when storage says it is full.
export const TIGHT_KEEP_DAYS = 60

const DAY_MS = 86_400_000

// --- Days ---------------------------------------------------------------------
// A day is a local calendar date written as 'YYYY-MM-DD'. Arithmetic runs on
// day numbers counted in UTC, so a daylight saving change never makes a day
// 23 or 25 hours long and never skips or repeats a date.

const pad = (n) => String(n).padStart(2, '0')

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function keyFromNumber(n) {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Milliseconds until the next local midnight (23 or 25 hours on a DST day). */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

// --- Versions and migration ----------------------------------------------------

export function emptyDoc() {
  return { version: VERSION, since: null, habits: [], days: {} }
}

// Version 1 kept each habit's history on the habit itself, as the ISO time of
// every check: { version: 1, habits: [{ id, name, archived, done: ['2026-10-04T07:12:09.000Z'] }] }.
// That grows by 24 characters per check and repeats on every habit. Version 2
// keys a compact map by local date and lists the habits done that day.
function v1ToV2(v1) {
  const days = {}
  const habits = []
  for (const old of Array.isArray(v1.habits) ? v1.habits : []) {
    if (!old || typeof old.id !== 'string') continue
    habits.push({ id: old.id, name: String(old.name ?? 'Habit'), archived: !!old.archived, before: { run: 0, best: 0 } })
    for (const iso of Array.isArray(old.done) ? old.done : []) {
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) continue
      // The timestamp is converted to the local date here, once: the same rule
      // the panel uses for "today".
      const key = dayKey(when)
      const list = (days[key] ??= [])
      if (!list.includes(old.id)) list.push(old.id)
    }
  }
  return { version: 2, since: null, habits, days }
}

// One step per version. Each step takes version n and returns version n + 1,
// so a document from any older release walks forward to the current one.
const MIGRATIONS = { 1: v1ToV2 }

export class NewerVersionError extends Error {}

/**
 * Brings a stored value up to the current version.
 * Returns { doc, migrated }. Throws NewerVersionError when a newer release of
 * this panel wrote it: overwriting would lose fields this release cannot see.
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.version)) throw new Error('unreadable')
  if (raw.version > VERSION) throw new NewerVersionError(`version ${raw.version}`)
  let doc = raw
  while (doc.version < VERSION) {
    const step = MIGRATIONS[doc.version]
    if (!step) throw new Error(`no migration from version ${doc.version}`)
    doc = step(doc)
  }
  return { doc: normalize(doc), migrated: doc !== raw }
}

// Fills in anything a hand edited or half written document lacks.
function normalize(doc) {
  doc.since = typeof doc.since === 'string' ? doc.since : null
  doc.habits = Array.isArray(doc.habits) ? doc.habits : []
  for (const h of doc.habits) h.before ??= { run: 0, best: 0 }
  doc.days = doc.days && typeof doc.days === 'object' ? doc.days : {}
  return doc
}

// --- Compaction ------------------------------------------------------------------

/**
 * Folds every day older than `keep` days into each habit's `before` totals and
 * drops it from `days`. `before.run` is the streak that reached the day just
 * before `since`; `before.best` the longest streak that ended before it.
 * Mutates `doc`; returns true when something was folded.
 */
export function compact(doc, today, keep = KEEP_DAYS) {
  const newSince = dayNumber(today) - keep + 1
  const oldKeys = Object.keys(doc.days).filter((k) => dayNumber(k) < newSince)
  if (doc.since && dayNumber(doc.since) >= newSince) return false
  if (!doc.since && oldKeys.length === 0) return false

  const start = doc.since ? dayNumber(doc.since) : Math.min(...oldKeys.map(dayNumber))
  for (const habit of doc.habits) {
    let { run, best } = habit.before
    for (let n = start; n < newSince; n++) {
      run = isDone(doc, habit.id, keyFromNumber(n)) ? run + 1 : 0
      best = Math.max(best, run)
    }
    habit.before = { run, best }
  }
  for (const key of oldKeys) delete doc.days[key]
  doc.since = keyFromNumber(newSince)
  return true
}

// --- Reading and writing checks ----------------------------------------------------

export function isDone(doc, id, key) {
  return doc.days[key]?.includes(id) ?? false
}

/** Marks or clears one habit on one day. Mutates `doc`. */
export function setDone(doc, id, key, done) {
  const list = doc.days[key] ?? []
  const next = done ? [...new Set([...list, id])] : list.filter((x) => x !== id)
  if (next.length) doc.days[key] = next
  else delete doc.days[key]
}

// --- Streaks -----------------------------------------------------------------------

/**
 * Days in a row up to today. A habit not yet checked today keeps yesterday's
 * streak: the day is not over.
 */
export function currentStreak(doc, habit, today) {
  const sinceN = doc.since ? dayNumber(doc.since) : -Infinity
  let n = dayNumber(today)
  if (!isDone(doc, habit.id, today)) n -= 1
  let count = 0
  while (n >= sinceN) {
    if (!isDone(doc, habit.id, keyFromNumber(n))) return count
    count++
    n--
  }
  // Every kept day back to `since` was done: the streak carries on into the
  // folded history.
  return count + habit.before.run
}

export function bestStreak(doc, habit) {
  const done = Object.keys(doc.days)
    .filter((k) => doc.days[k].includes(habit.id))
    .map(dayNumber)
    .sort((a, b) => a - b)
  let best = habit.before.best
  let run = habit.before.run
  let prev = doc.since ? dayNumber(doc.since) - 1 : null
  for (const n of done) {
    run = prev !== null && n === prev + 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = n
  }
  return best
}

/** The last `count` days, oldest first, as { key, done }. */
export function recentDays(doc, id, today, count = 14) {
  const end = dayNumber(today)
  return Array.from({ length: count }, (_, i) => {
    const key = keyFromNumber(end - count + 1 + i)
    return { key, done: isDone(doc, id, key) }
  })
}

export function newHabitId(doc) {
  const taken = new Set(doc.habits.map((h) => h.id))
  let id
  do id = `h${Math.random().toString(36).slice(2, 7)}`
  while (taken.has(id))
  return id
}
