// Reading what the person typed as a moment in time. No DOM, no bridge.

/** { ms, unit } for a timestamp or a date the browser understands, or
 *  { error }. Digits are read by their length: 10 or fewer are seconds,
 *  13 milliseconds, 16 microseconds, 19 nanoseconds. */
export function readMoment(text, now = Date.now()) {
  const value = text.trim()
  if (!value) return { empty: true }
  if (/^now$/i.test(value)) return { ms: now, unit: 'now' }

  const numeric = /^[-+]?\d+(\.\d+)?$/.test(value)
  if (numeric) {
    const n = Number(value)
    const digits = value.replace(/^[-+]/, '').split('.')[0].length
    let ms
    let unit
    if (digits <= 11) [ms, unit] = [n * 1000, 'seconds']
    else if (digits <= 14) [ms, unit] = [n, 'milliseconds']
    else if (digits <= 17) [ms, unit] = [n / 1000, 'microseconds']
    else [ms, unit] = [n / 1e6, 'nanoseconds']
    return check(ms, unit)
  }

  // Dates: ISO 8601 and RFC 2822 parse reliably. A bare "2026-01-01" is UTC
  // in JavaScript; say so instead of surprising anyone.
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    return { error: 'Not a timestamp or a date this panel can read. Try 1767225600, 1767225600000 or 2026-01-01T09:30:00Z.' }
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const noZone = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value)
  return check(ms, dateOnly ? 'date, read as midnight UTC' : noZone ? 'date, read in your time zone' : 'date')
}

function check(ms, unit) {
  // JavaScript dates reach 8.64e15 ms either side of 1970.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return { error: 'That is outside the range a date can hold.' }
  return { ms, unit }
}

export function relative(ms, now, locale) {
  const diff = ms - now
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const units = [
    ['year', 365.25 * 864e5],
    ['month', 30.44 * 864e5],
    ['week', 7 * 864e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
    ['second', 1e3],
  ]
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'second') return rtf.format(Math.round(diff / size), unit)
  }
  return ''
}

export function isZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** A zone name in any case (asia/tokyo) or a city in the list (tokyo). */
export function findZone(text, zones) {
  const query = text.trim()
  if (!query) return null
  if (/^utc$/i.test(query)) return 'UTC'
  if (isZone(query)) return new Intl.DateTimeFormat('en-US', { timeZone: query }).resolvedOptions().timeZone
  const city = query.toLowerCase().replaceAll(' ', '_')
  const listed = zones.find((z) => z.split('/').pop().toLowerCase() === city)
  if (listed) return listed
  // The list can carry an older name (Asia/Calcutta) for a city people know by
  // its new one (Kolkata). Intl still accepts the new name: try it under each
  // region.
  const name = city.replace(/(^|_)([a-z])/g, (m) => m.toUpperCase())
  for (const area of new Set(zones.map((z) => z.split('/')[0]))) {
    if (isZone(`${area}/${name}`)) return `${area}/${name}`
  }
  return null
}

export function offsetIn(zone, ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')
  return part ? part.value.replace('GMT', 'UTC') || 'UTC' : ''
}
