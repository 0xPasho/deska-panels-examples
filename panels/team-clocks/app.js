/* Team Clocks: the local time of your teammates and cities, how far ahead or
 * behind you they are, and whether it is a reasonable hour to reach them.
 *
 * What this panel teaches:
 * - deska.ready() and the init payload (init.locale formats every time).
 * - Theme tokens as CSS variables: app.css only uses var(--deska-*).
 * - deska.storage.get and set to keep the list across reloads.
 * - deska.setTitle and deska.on('visibility') to pause the clock when hidden.
 *
 * The file reads top to bottom in five steps: wait for ready, apply the
 * theme, load from storage, render, save. */

const STORAGE_KEY = 'places'
const $ = (id) => document.getElementById(id)
const ZONES = Intl.supportedValuesOf('timeZone')
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

let locale = 'en-US'
let places = []
let timer = null

// Step 1: wait for ready ------------------------------------------------------

// ready() resolves once Deska answers with the init payload. Nothing from the
// bridge is usable before it, and a page opened outside Deska waits forever.
const init = await deska.ready()

// init.locale is the person's language in Deska, so times read the way the
// rest of the app writes them (14:05 or 2:05 PM).
locale = init.locale || navigator.language

// Step 2: apply the theme -----------------------------------------------------

// Nothing to do here: the SDK writes init.theme.tokens as --deska-* custom
// properties on <html> and keeps them current on every theme change, so
// app.css follows Deska with var(). Listen to deska.on('theme') only when you
// draw with colors outside CSS, like on a <canvas>.

// Step 3: load from storage ---------------------------------------------------

async function load() {
  showStatus('Loading')
  try {
    // storage is per package and per computer, and survives every reload.
    // null means this package never saved the key: a first run.
    const saved = await deska.storage.get(STORAGE_KEY)
    places = Array.isArray(saved) ? saved.filter(isPlace) : examplePlaces()
    showList()
    // A panel can start hidden (a far view, a folded dock): draw once, tick later.
    if (deska.visible) startClock()
    else render()
  } catch (err) {
    showStatus(`Could not load your places (${err.code}).`, { retry: true })
  }
}

function isPlace(value) {
  return value && typeof value.zone === 'string' && typeof value.label === 'string' && isZone(value.zone)
}

function isZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function examplePlaces() {
  const picks = ['Europe/London', 'Asia/Tokyo', 'America/New_York'].filter((zone) => zone !== LOCAL_ZONE).slice(0, 2)
  return [{ zone: LOCAL_ZONE, label: cityOf(LOCAL_ZONE) }, ...picks.map((zone) => ({ zone, label: cityOf(zone) }))]
}

// Step 4: render --------------------------------------------------------------

function render() {
  const now = new Date()
  const list = $('clocks')
  list.replaceChildren(...places.map((place, index) => clockRow(place, index, now)))
  $('status').hidden = places.length > 0
  if (!places.length) $('status').textContent = 'No places yet. Add a teammate or a city to see their time.'
  updateTitle(now)
}

function clockRow(place, index, now) {
  const row = document.createElement('li')
  row.className = 'clock'
  row.innerHTML = `
    <div class="where"><span class="name"></span><span class="meta"></span></div>
    <div class="when"><time class="time"></time><span class="meta"></span></div>
    <button type="button" class="remove"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7"/></svg></button>`
  const [whereMeta, whenMeta] = row.querySelectorAll('.meta')
  row.querySelector('.name').textContent = place.label
  row.querySelector('.time').textContent = timeIn(place.zone, now)
  whereMeta.textContent = relativeTo(place.zone, now)
  whenMeta.textContent = hourKind(place.zone, now)
  const remove = row.querySelector('.remove')
  remove.setAttribute('aria-label', `Remove ${place.label}`)
  remove.addEventListener('click', () => removePlace(index))
  return row
}

function updateTitle(now) {
  // The title shows under the panel's name on the canvas, so the first place's
  // time is readable even when the panel is small. Deska takes a non-empty
  // title of up to 60 characters; there is no null, so the panel's own name
  // stands for "no title".
  const first = places[0]
  const title = first ? `${first.label.slice(0, 40)} ${timeIn(first.zone, now)}` : init.panel.name
  deska.setTitle(title).catch((err) => console.warn(`setTitle failed: ${err.code}`))
}

function timeIn(zone, date) {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, timeStyle: 'short' }).format(date)
}

function partsIn(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', hour: 'numeric', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type).value
  const offset = /([+-])(\d{2}):(\d{2})/.exec(get('timeZoneName'))
  return {
    hour: Number(get('hour')),
    weekend: ['Sat', 'Sun'].includes(get('weekday')),
    day: `${get('year')}-${get('month')}-${get('day')}`,
    offset: offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0,
  }
}

function relativeTo(zone, now) {
  const there = partsIn(zone, now)
  const here = partsIn(LOCAL_ZONE, now)
  const diff = there.offset - here.offset
  if (diff === 0) return 'Same time as you'
  const hours = Math.floor(Math.abs(diff) / 60)
  const minutes = Math.abs(diff) % 60
  const span = [hours && `${hours} h`, minutes && `${minutes} min`].filter(Boolean).join(' ')
  const day = there.day > here.day ? ', tomorrow' : there.day < here.day ? ', yesterday' : ''
  return `${span} ${diff > 0 ? 'ahead' : 'behind'}${day}`
}

function hourKind(zone, now) {
  const { hour, weekend } = partsIn(zone, now)
  if (hour < 7 || hour >= 22) return 'Night'
  if (weekend) return 'Weekend'
  if (hour < 9) return 'Early morning'
  if (hour < 18) return 'Working hours'
  return 'Evening'
}

function cityOf(zone) {
  return zone.split('/').pop().replaceAll('_', ' ')
}

// The clock ticks on each minute, and only while someone can see it.
function startClock() {
  stopClock()
  render()
  timer = setTimeout(startClock, 60_000 - (Date.now() % 60_000) + 50)
}

function stopClock() {
  clearTimeout(timer)
  timer = null
}

// Deska tells a panel when it is scrolled off the canvas, folded away or behind
// a far view. A hidden panel keeps running, so stop the timer to save work, and
// catch up the moment it shows again.
deska.on('visibility', ({ visible }) => (visible ? startClock() : stopClock()))

// Step 5: save ----------------------------------------------------------------

async function save() {
  try {
    await deska.storage.set(STORAGE_KEY, places)
    showNotice('')
  } catch (err) {
    // Each bridge error has a code; answer the ones a person can act on.
    const messages = {
      storage_full: 'Storage is full. Remove a place and try again.',
      rate_limited: 'Too many changes at once. Your next change will save.',
    }
    showNotice(messages[err.code] || `Could not save your places (${err.code}).`)
  }
}

function addPlace(zone, label) {
  places.push({ zone, label: label || cityOf(zone) })
  render()
  save()
}

function removePlace(index) {
  places.splice(index, 1)
  render()
  save()
  // Keep keyboard focus on the list after the row it was on disappears.
  const buttons = $('clocks').querySelectorAll('.remove')
  ;(buttons[Math.min(index, buttons.length - 1)] || $('add-open')).focus()
}

// The add form ----------------------------------------------------------------

function fillZones() {
  $('zones').replaceChildren(...ZONES.map((zone) => new Option(cityOf(zone), zone)))
}

// Accepts a zone name in any case (asia/tokyo, Asia/Kolkata) or a city in the
// list (tokyo). Intl knows more names than supportedValuesOf lists.
function findZone(text) {
  const query = text.trim()
  if (!query) return null
  if (isZone(query)) return new Intl.DateTimeFormat('en-US', { timeZone: query }).resolvedOptions().timeZone
  const city = query.toLowerCase().replaceAll(' ', '_')
  return ZONES.find((zone) => zone.split('/').pop().toLowerCase() === city) || null
}

function openForm() {
  $('footer').hidden = true
  $('add-form').hidden = false
  $('form-error').textContent = ''
  $('zone').removeAttribute('aria-invalid')
  $('zone').focus()
}

function closeForm() {
  $('add-form').reset()
  $('add-form').hidden = true
  $('footer').hidden = false
  $('add-open').focus()
}

$('add-open').addEventListener('click', openForm)
$('add-cancel').addEventListener('click', closeForm)
$('add-form').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeForm()
})
$('add-form').addEventListener('submit', (event) => {
  // Panels run with form-action 'none': a real submit would be blocked.
  event.preventDefault()
  const zone = findZone($('zone').value)
  if (!zone) {
    $('form-error').textContent = 'Pick a time zone from the list.'
    $('zone').setAttribute('aria-invalid', 'true')
    $('zone').focus()
    return
  }
  addPlace(zone, $('label').value.trim())
  closeForm()
})

// Screens ---------------------------------------------------------------------

function showStatus(text, { retry = false } = {}) {
  $('app').setAttribute('aria-busy', String(text === 'Loading'))
  $('clocks').hidden = true
  $('footer').hidden = true
  const status = $('status')
  status.hidden = false
  status.textContent = text
  if (retry) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'text-button'
    button.textContent = 'Try again'
    button.addEventListener('click', load)
    status.append(' ', button)
  }
}

function showList() {
  $('app').setAttribute('aria-busy', 'false')
  $('clocks').hidden = false
  $('footer').hidden = false
}

function showNotice(text) {
  $('notice').textContent = text
}

fillZones()
await load()
