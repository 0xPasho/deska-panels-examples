// Reading a five-field cron expression, saying it in words, and finding its
// next runs. No DOM and no bridge here.

export const FIELDS = [
  { key: 'minute', label: 'Minute', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', min: 0, max: 23 },
  { key: 'day', label: 'Day of month', min: 1, max: 31 },
  { key: 'month', label: 'Month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { key: 'weekday', label: 'Day of week', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
]

export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export class CronError extends Error {}

/** Parses an expression into { fields: [{ values:Set, any, source }], source }.
 *  Throws CronError with a sentence a person can act on. */
export function parseCron(text) {
  let source = text.trim().replace(/\s+/g, ' ')
  if (!source) throw new CronError('Write a cron expression, like 0 9 * * 1-5.')
  const macro = MACROS[source.toLowerCase()]
  if (macro) source = macro
  else if (source.startsWith('@')) throw new CronError(`${source} is not a shortcut cron knows. Try @hourly, @daily, @weekly, @monthly or @yearly.`)
  const parts = source.split(' ')
  if (parts.length === 6) throw new CronError('This has 6 fields. Standard cron has 5: minute, hour, day of month, month and day of week. Remove the seconds or the year.')
  if (parts.length !== 5) throw new CronError(`This has ${parts.length} ${parts.length === 1 ? 'field' : 'fields'}. Cron needs 5: minute, hour, day of month, month and day of week.`)
  const fields = parts.map((part, i) => parseField(part, FIELDS[i]))
  // 7 is Sunday too.
  const wd = fields[4].values
  if (wd.has(7)) {
    wd.delete(7)
    wd.add(0)
  }
  return { fields, source, macro: macro ? text.trim().toLowerCase() : null }
}

function parseField(part, field) {
  const values = new Set()
  for (const item of part.split(',')) {
    if (!item) throw new CronError(`The ${field.label.toLowerCase()} field has an empty item between commas.`)
    const [range, stepText] = item.split('/')
    let step = 1
    if (stepText !== undefined) {
      step = Number(stepText)
      if (!/^\d+$/.test(stepText) || step < 1) throw new CronError(`"/${stepText}" in the ${field.label.toLowerCase()} field must be a whole number of 1 or more.`)
    }
    let from
    let to
    if (range === '*') {
      from = field.min
      to = field.key === 'weekday' ? 6 : field.max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      from = value(a, field)
      to = value(b, field)
      if (from > to) throw new CronError(`The range ${range} in the ${field.label.toLowerCase()} field runs backwards. Write the smaller number first.`)
    } else {
      from = value(range, field)
      to = stepText !== undefined ? (field.key === 'weekday' ? 6 : field.max) : from
    }
    for (let v = from; v <= to; v += step) values.add(v)
  }
  return { values, any: part === '*', source: part }
}

function value(text, field) {
  const lower = String(text).toLowerCase()
  const named = field.names?.indexOf(lower)
  if (named !== undefined && named >= 0) return field.key === 'month' ? named + 1 : named
  if (!/^\d+$/.test(lower)) throw new CronError(`"${text}" is not a valid ${field.label.toLowerCase()}.`)
  const n = Number(lower)
  if (n < field.min || n > field.max) throw new CronError(`${n} is outside the ${field.label.toLowerCase()} range, ${field.min} to ${field.max}.`)
  return n
}

// Next runs -------------------------------------------------------------------------

/** Wall-clock parts of `date` in `zone` ('local' or an IANA name). */
function partsIn(date, zone) {
  if (zone === 'local') {
    return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), wd: date.getDay() }
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }
}

function matchesDay(cron, p) {
  const [, , dom, , dow] = cron.fields
  const domOk = dom.values.has(p.d)
  const dowOk = dow.values.has(p.wd)
  // Classic cron: when both day fields are restricted, either one may match.
  if (!dom.any && !dow.any) return domOk || dowOk
  return domOk && dowOk
}

/** The next `count` run times after `from`. Walks minute by minute but skips
 *  whole hours and days that cannot match, so it stays fast. Gives up after
 *  five years (an expression like 0 0 31 2 * never runs). */
export function nextRuns(cron, from, count, zone = 'local') {
  const [mins, hours, , months] = cron.fields
  const out = []
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000
  const end = t + 5 * 366 * 24 * 3_600_000
  while (out.length < count && t < end) {
    const p = partsIn(new Date(t), zone)
    if (!months.values.has(p.mo) || !matchesDay(cron, p)) {
      t += (24 * 60 - p.h * 60 - p.mi) * 60_000 // to the next midnight
      continue
    }
    if (!hours.values.has(p.h)) {
      t += (60 - p.mi) * 60_000
      continue
    }
    if (mins.values.has(p.mi)) out.push(new Date(t))
    t += 60_000
  }
  return out
}

// Words -----------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0')

function list(words) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** Consecutive values become "a through b". */
function runs(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const out = []
  for (const v of sorted) {
    const last = out.at(-1)
    if (last && v === last[1] + 1) last[1] = v
    else out.push([v, v])
  }
  return out
}

function spoken(values, name) {
  return list(runs(values).map(([a, b]) => (a === b ? name(a) : b === a + 1 ? `${name(a)} and ${name(b)}` : `${name(a)} through ${name(b)}`)))
}

function stepOf(field) {
  const m = /^\*\/(\d+)$/.exec(field.source)
  return m ? Number(m[1]) : null
}

export function describe(cron) {
  const [mi, h, dom, mo, dow] = cron.fields
  let time
  const mStep = stepOf(mi)
  const hStep = stepOf(h)
  if (mi.values.size === 1 && h.values.size === 1) {
    time = `At ${two([...h.values][0])}:${two([...mi.values][0])}`
  } else if (mi.values.size === 1 && h.values.size <= 6 && !h.any && !hStep) {
    const m = [...mi.values][0]
    time = `At ${list([...h.values].sort((a, b) => a - b).map((x) => `${two(x)}:${two(m)}`))}`
  } else {
    let minutePart
    if (mi.any) minutePart = 'Every minute'
    else if (mStep) minutePart = `Every ${mStep} minutes`
    else if (mi.values.size === 1) minutePart = [...mi.values][0] === 0 ? 'At the top of the hour' : `At minute ${[...mi.values][0]} past the hour`
    else minutePart = `At minutes ${spoken(mi.values, String)}`
    let hourPart = ''
    const hourRuns = runs(h.values)
    if (hStep) hourPart = `, every ${hStep} hours`
    else if (h.any) hourPart = ''
    else if (h.values.size === 1) hourPart = `, during the ${two([...h.values][0])}:00 hour`
    else if (hourRuns.length === 1) hourPart = `, between ${two(hourRuns[0][0])}:00 and ${two(hourRuns[0][1])}:59`
    else hourPart = `, during the hours ${spoken(h.values, (x) => `${two(x)}:00`)}`
    time = minutePart + hourPart
  }

  const days = []
  if (!dom.any) days.push(`on day ${spoken(dom.values, String)} of the month`)
  if (!dow.any) days.push(`on ${spoken(dow.values, (d) => DAYS[d])}`)
  let dayText = days.join(dom.any || dow.any ? ' ' : ', or ')
  if (!mo.any) dayText += `${dayText ? ' ' : ''}in ${spoken(mo.values, (m) => MONTHS[m - 1])}`
  return `${time}${dayText ? `, ${dayText}` : ''}.`
}

/** What each field says on its own, for the breakdown table. */
export function fieldMeaning(cron, index) {
  const f = cron.fields[index]
  const def = FIELDS[index]
  if (f.any) return `Every ${['minute', 'hour', 'day', 'month', 'day'][index]}`
  const step = stepOf(f)
  if (step) return `Every ${step}`
  const name = def.key === 'month' ? (m) => MONTHS[m - 1] : def.key === 'weekday' ? (d) => DAYS[d] : String
  const words = spoken(f.values, name)
  if (def.key === 'minute') return `At minute ${words}`
  if (def.key === 'hour') return `At hour ${words}`
  if (def.key === 'day') return `On day ${words}`
  return words
}
