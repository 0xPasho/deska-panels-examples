// The part both pages share: index.html (the panel on the desk) and
// extras.html (the compact view inside Extras) are two pages of one package,
// so they read and write the same deska.storage keys. Neither page can message
// the other directly; storage is the meeting point, and each page re-reads it
// on a short timer to pick up what the other one changed.

const KEY = 'countdowns'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A readable message for a bridge error. The SDK rejects with an Error whose `code` is the bridge code. */
export function describeError(err) {
  const code = err?.code || err?.message || 'host_error'
  if (code === 'storage_full') return 'Storage is full. Remove a few countdowns and try again.'
  if (code === 'rate_limited') return 'Too many changes at once. Try again in a moment.'
  if (code === 'not_ready') return 'The panel is still starting. Try again in a moment.'
  return 'Countdowns could not be read or saved.'
}

// First run: one countdown a few days out, set a week ago, so the panel opens
// on something real instead of an empty form.
function seed(now) {
  const target = new Date(now + 3 * DAY)
  target.setHours(10, 0, 0, 0)
  return [{ id: makeId(), name: 'Public beta', target: target.getTime(), setAt: now - 7 * DAY, notified: false, dismissed: false }]
}

export function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

/** Every countdown, seeding the list on the very first run. `null` in storage means never written. */
export async function load() {
  const stored = await deska.storage.get(KEY)
  if (Array.isArray(stored)) return stored
  const seeded = seed(Date.now())
  await save(seeded)
  return seeded
}

export function save(list) {
  return deska.storage.set(KEY, list)
}

/** Load, change, save: always start from the stored list so the other page's edits survive. */
export async function update(change) {
  const list = await load()
  const next = change(list)
  await save(next)
  return next
}

export const isDone = (c, now) => c.target <= now

/** Upcoming first (soonest first), then finished ones (most recent first). */
export function sorted(list, now) {
  const upcoming = list.filter((c) => !isDone(c, now)).sort((a, b) => a.target - b.target)
  const done = list.filter((c) => isDone(c, now)).sort((a, b) => b.target - a.target)
  return [...upcoming, ...done]
}

/** How much of the run-up has gone by, from the moment it was set to the target, 0 to 1. */
export function elapsed(c, now) {
  const span = c.target - c.setAt
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (now - c.setAt) / span))
}

/** Days, hours and minutes left, rounding up so the last minute reads 0 0 1, not 0 0 0. */
export function left(c, now) {
  const minutes = Math.max(0, Math.ceil((c.target - now) / MINUTE))
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 }
}

export function shippedAgo(c, now) {
  const ago = now - c.target
  if (ago < MINUTE) return 'Shipped just now'
  if (ago < HOUR) return `Shipped ${Math.floor(ago / MINUTE)} min ago`
  if (ago < DAY) return `Shipped ${Math.floor(ago / HOUR)} h ago`
  const days = Math.floor(ago / DAY)
  return `Shipped ${days} ${days === 1 ? 'day' : 'days'} ago`
}

export function formatTarget(c, locale) {
  return new Date(c.target).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** A short line for small places: "3d 4h left", "4h 12m left", "12m left". */
export function shortLeft(c, now) {
  const { days, hours, minutes } = left(c, now)
  if (days) return `${days}d ${hours}h left`
  if (hours) return `${hours}h ${minutes}m left`
  return `${minutes}m left`
}

// ---- Extras -----------------------------------------------------------------

/**
 * What the Extras row should say. A finished countdown nobody has dismissed
 * wins, with a stop control to dismiss it. Otherwise the soonest upcoming one
 * drives the row: its name as the state line, its target as `until`, and the
 * elapsed run-up as the ring.
 */
export function extrasFor(list, now) {
  // Deska refuses a state line longer than 60 characters rather than cutting it.
  const fit = (text) => (text.length <= 60 ? text : `${text.slice(0, 59).trimEnd()}…`)
  const finished = list.filter((c) => isDone(c, now) && !c.dismissed).sort((a, b) => b.target - a.target)[0]
  if (finished) return { state: fit(`${finished.name}: ${shippedAgo(finished, now).toLowerCase()}`), until: null, progress: 1, control: 'stop' }
  const next = list.filter((c) => !isDone(c, now)).sort((a, b) => a.target - b.target)[0]
  if (!next) return { state: 'Nothing scheduled', until: null, progress: null, control: 'start' }
  return {
    state: fit(next.name),
    // `until` is the key field: Deska draws the time left from it and keeps
    // counting on its own, even after every frame of this package is gone.
    // A countdown never has to stay open just to keep the Extras row honest.
    until: next.target,
    // Rounded so the ring is only redrawn when it visibly moves.
    progress: Math.round(elapsed(next, now) * 1000) / 1000,
    control: null,
  }
}

let lastExtras = ''

/** Sends the Extras fields only when they changed: two pages tick every second, the bridge allows 20 calls a second. */
export async function syncExtras(list, now) {
  const fields = extrasFor(list, now)
  const key = JSON.stringify(fields)
  if (key === lastExtras) return
  lastExtras = key
  try {
    await deska.extras.set(fields)
  } catch (err) {
    lastExtras = ''
    // permission_denied only happens if panel.json stops declaring extras.
    console.warn('Extras could not be updated:', err.code || err.message)
  }
}

/** The Extras stop control dismisses the finished countdown it shows. */
export function dismissFinished(now) {
  return update((list) => list.map((c) => (isDone(c, now) && !c.dismissed ? { ...c, dismissed: true } : c)))
}

// ---- Notify, once per countdown ----------------------------------------------

/**
 * Says "Launch day is here" once per countdown that reached zero, even across
 * reloads and with both pages open: the `notified` flag is written to storage
 * before the notification goes out, so a page that reloads (or the other page
 * on its next tick) sees it and stays quiet.
 */
let quietUntil = 0

export async function notifyFinished(now) {
  const list = await load()
  const due = list.find((c) => isDone(c, now) && !c.notified)
  if (!due || now < quietUntil) return list
  const marked = list.map((c) => (c.id === due.id ? { ...c, notified: true } : c))
  await save(marked)
  try {
    await deska.notify({ title: 'Launch day is here', body: `${due.name} is due now.` })
  } catch (err) {
    // Deska allows one notification every 10 s per panel. If two countdowns
    // end together, clear the flag and try again once the window has passed.
    if (err.code === 'rate_limited') {
      quietUntil = Date.now() + 10_000
      await update((l) => l.map((c) => (c.id === due.id ? { ...c, notified: false } : c)))
    } else if (err.code !== 'permission_denied') {
      console.warn('Notification failed:', err.code || err.message)
    }
  }
  return marked
}
