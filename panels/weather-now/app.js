/* Weather Now: current conditions, the next 12 hours and five days for the
 * places you save, from Open-Meteo. Search a city, keep several, switch
 * between them. Units follow the person's locale until they pick their own.
 *
 * What this panel teaches:
 * - init.locale with Intl: units by region, hour cycle, numbers and wind speed.
 * - Forms in a sandboxed frame: form-action is 'none', so submit is handled here.
 * - Debounced search with AbortController, so a stale answer never lands.
 * - Caching the last forecast in deska.storage, so a reload or an offline
 *   start shows something at once, with "Updated 20 minutes ago".
 */
import { describe, iconSvg, UI_ICONS } from './weather.js'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const ATTRIBUTION_URL = 'https://open-meteo.com/'
const STALE_MS = 15 * 60_000
const SEARCH_DELAY_MS = 300
const MAX_PLACES = 10
// Regions where people read °F and mph. Everyone else gets °C and km/h.
const IMPERIAL_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'LR'])
// First run seeds one well known city so the panel opens on real weather.
const SEED_PLACE = { id: 3530597, name: 'Mexico City', region: 'Mexico', lat: 19.42847, lon: -99.12766 }

const $ = (id) => document.getElementById(id)

const state = {
  places: [],
  activeId: null,
  units: 'metric',
  forecast: null,
  loading: false,
  error: null,
  results: [],
  highlighted: -1,
}
let fmt = makeFormatters('en-US')
let forecastAbort = null
let searchAbort = null
let searchTimer = null
let noteTimer = null

start()

async function start() {
  // ready() resolves with the init payload; init.locale is the person's
  // language and region (like es-MX), which drives units and formats.
  const init = await deska.ready()
  const locale = canonicalLocale(init.locale)
  fmt = makeFormatters(locale)

  const [places, activeId, units] = await Promise.all([load('places'), load('activeId'), load('units')])
  // null means this package never saved places on this computer: first run.
  state.places = Array.isArray(places) ? places : [SEED_PLACE]
  if (places === null) save('places', state.places)
  state.activeId = state.places.some((p) => p.id === activeId) ? activeId : (state.places[0]?.id ?? null)
  // A stored choice wins; until the person picks, the locale decides.
  state.units = units === 'metric' || units === 'imperial' ? units : unitsForLocale(locale)

  wire()
  $('app').removeAttribute('aria-busy')
  await showActive()
  setInterval(tick, 30_000)
}

// --- storage ---------------------------------------------------------------

/** deska.storage is the only storage that survives here: the frame's origin
 * is opaque, so localStorage and indexedDB throw. Errors come back with a
 * code (err.code), so each one can be answered for what it is. */
async function load(key) {
  try {
    return await deska.storage.get(key)
  } catch (err) {
    note(storageMessage(err))
    return null
  }
}

async function save(key, value) {
  try {
    await deska.storage.set(key, value)
  } catch (err) {
    note(storageMessage(err))
  }
}

async function forget(key) {
  try {
    await deska.storage.remove(key)
  } catch (err) {
    note(storageMessage(err))
  }
}

function storageMessage(err) {
  if (err?.code === 'storage_full') return 'Storage is full, so this change will not last after a reload.'
  if (err?.code === 'rate_limited') return 'Too many changes at once. Try again in a moment.'
  return 'Could not reach storage. Changes may not last after a reload.'
}

const cacheKey = (id) => `forecast:${id}`

// --- locale and formats ------------------------------------------------------

function canonicalLocale(locale) {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'en-US'
  } catch {
    return 'en-US'
  }
}

function unitsForLocale(locale) {
  // maximize() fills in the likely region: "en" becomes "en-Latn-US".
  const region = new Intl.Locale(locale).maximize().region
  return IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric'
}

/** The copy is English, so words use 'en'; the person's locale still decides
 * the hour cycle (17:00 or 5 PM) and how numbers and units are written. */
function makeFormatters(locale) {
  const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
  const speed = (unit) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 0 })
  return {
    number: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    kmh: speed('kilometer-per-hour'),
    mph: speed('mile-per-hour'),
    // Forecast times are the place's wall clock; reading them as UTC keeps
    // the panel's own time zone out of it.
    hour: new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle, timeZone: 'UTC' }),
    weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }),
    relative: new Intl.RelativeTimeFormat('en', { numeric: 'always' }),
  }
}

function temperature(celsius) {
  const value = state.units === 'imperial' ? (celsius * 9) / 5 + 32 : celsius
  return `${fmt.number.format(Math.round(value) || 0)}°`
}

function wind(kmh) {
  return state.units === 'imperial' ? fmt.mph.format(kmh / 1.609344) : fmt.kmh.format(kmh)
}

function updatedText(at) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${fmt.relative.format(-minutes, 'minute')}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Updated ${fmt.relative.format(-hours, 'hour')}`
  return `Updated ${fmt.relative.format(-Math.round(hours / 24), 'day')}`
}

/** "2026-10-05T17:00" read as a wall clock time. */
const wallTime = (iso) => new Date(`${iso.length === 10 ? `${iso}T00:00` : iso}Z`)

/** The place's current hour as Open-Meteo writes it, from its UTC offset. */
function placeHour(offsetSeconds) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString().slice(0, 13) + ':00'
}

// --- forecast ----------------------------------------------------------------

const activePlace = () => state.places.find((p) => p.id === state.activeId) ?? null

async function showActive() {
  const place = activePlace()
  forecastAbort?.abort()
  state.error = null
  state.loading = false
  // Show the cached forecast first, so a reload or offline start is instant.
  state.forecast = place ? await load(cacheKey(place.id)) : null
  render()
  if (place && isStale(state.forecast)) refresh()
}

const isStale = (forecast) => !forecast || Date.now() - forecast.fetchedAt > STALE_MS

async function refresh() {
  const place = activePlace()
  if (!place) return
  forecastAbort?.abort()
  const controller = new AbortController()
  forecastAbort = controller
  state.loading = true
  state.error = null
  render()
  try {
    const forecast = await fetchForecast(place, controller.signal)
    state.forecast = forecast
    save(cacheKey(place.id), forecast)
  } catch (err) {
    if (controller.signal.aborted) return
    state.error = navigator.onLine === false ? 'offline' : 'failed'
  }
  state.loading = false
  render()
}

/** Fetches in °C and km/h always; the unit toggle converts on screen, so the
 * cache stays valid whichever unit the person reads. */
async function fetchForecast(place, signal) {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '6',
  })
  // Open-Meteo answers Access-Control-Allow-Origin: *, which is what a
  // panel's opaque origin needs, and the host is listed in panel.json.
  const response = await fetch(`${FORECAST_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`forecast ${response.status}`)
  const raw = await response.json()
  return trimForecast(raw)
}

/** Keeps only what the panel draws, so a cached forecast stays a few KB. */
function trimForecast(raw) {
  const { current, hourly, daily } = raw
  const from = Math.max(0, hourly.time.indexOf(current.time.slice(0, 13) + ':00'))
  const hours = hourly.time.slice(from, from + 36).map((time, i) => ({
    time,
    temp: hourly.temperature_2m[from + i],
    code: hourly.weather_code[from + i],
    day: hourly.is_day[from + i] === 1,
  }))
  const days = daily.time.map((date, i) => ({
    date,
    code: daily.weather_code[i],
    max: daily.temperature_2m_max[i],
    min: daily.temperature_2m_min[i],
  }))
  return {
    fetchedAt: Date.now(),
    offset: raw.utc_offset_seconds,
    current: {
      temp: current.temperature_2m,
      feels: current.apparent_temperature,
      code: current.weather_code,
      wind: current.wind_speed_10m,
      day: current.is_day === 1,
    },
    hours,
    days,
  }
}

// --- rendering ---------------------------------------------------------------

function render() {
  renderHeader()
  renderBody()
  renderFooter()
}

function renderHeader() {
  const place = activePlace()
  $('place-name').textContent = place?.name ?? 'Weather'
  $('place-region').textContent = place?.region ?? ''
  $('place-region').hidden = !place?.region
  $('unit-metric').setAttribute('aria-pressed', String(state.units === 'metric'))
  $('unit-imperial').setAttribute('aria-pressed', String(state.units === 'imperial'))
}

function renderBody() {
  const body = $('body')
  const place = activePlace()
  const forecast = state.forecast
  if (!place) return body.replaceChildren(message('No places yet.', 'Add a place', openPlaces))
  if (forecast) return body.replaceChildren(...forecastView(forecast))
  if (state.error === 'offline') return body.replaceChildren(message('You are offline, and there is no saved forecast for this place yet.', 'Retry', refresh))
  if (state.error) return body.replaceChildren(message('Could not get the forecast.', 'Retry', refresh))
  body.replaceChildren(message(`Getting the forecast for ${place.name}`))
}

function forecastView(forecast) {
  const now = placeHour(forecast.offset)
  const hours = forecast.hours.filter((h) => h.time >= now).slice(0, 12)
  const days = forecast.days.filter((d) => d.date >= now.slice(0, 10)).slice(0, 5)
  return [currentView(forecast.current), hoursView(hours), daysView(days)]
}

function currentView(current) {
  const { words, icon } = describe(current.code, current.day)
  const section = el('section', 'current')
  section.setAttribute('aria-label', 'Now')
  const glyph = iconElement(icon)
  glyph.classList.add('current-icon')
  const temp = el('p', 'current-temp', temperature(current.temp))
  const detail = el('div', 'current-detail')
  detail.append(
    el('p', 'current-words', words),
    el('p', 'secondary', `Feels like ${temperature(current.feels)}`),
    el('p', 'secondary', `Wind ${wind(current.wind)}`),
  )
  section.append(glyph, temp, detail)
  return section
}

function hoursView(hours) {
  const section = el('section', 'block')
  section.setAttribute('aria-labelledby', 'hours-title')
  const title = el('h2', 'caption', 'Next 12 hours')
  title.id = 'hours-title'
  const list = el('ol', 'hours')
  hours.forEach((hour, i) => {
    const { words, icon } = describe(hour.code, hour.day)
    const item = el('li', 'hour')
    item.append(
      el('span', 'hour-time', i === 0 ? 'Now' : fmt.hour.format(wallTime(hour.time))),
      iconElement(icon, words),
      el('span', 'hour-temp', temperature(hour.temp)),
    )
    list.append(item)
  })
  section.append(title, list)
  return section
}

function daysView(days) {
  const section = el('section', 'block')
  section.setAttribute('aria-labelledby', 'days-title')
  const title = el('h2', 'caption', '5 days')
  title.id = 'days-title'
  const low = Math.min(...days.map((d) => d.min))
  const span = Math.max(1, Math.max(...days.map((d) => d.max)) - low)
  const list = el('ol', 'days')
  days.forEach((day, i) => {
    const { words, icon } = describe(day.code)
    const item = el('li', 'day')
    const range = el('span', 'range')
    range.setAttribute('aria-hidden', 'true')
    const fill = el('span', 'range-fill')
    fill.style.insetInlineStart = `${((day.min - low) / span) * 100}%`
    fill.style.insetInlineEnd = `${((low + span - day.max) / span) * 100}%`
    range.append(fill)
    item.append(
      el('span', 'day-name', i === 0 ? 'Today' : fmt.weekday.format(wallTime(day.date))),
      iconElement(icon, words),
      el('span', 'day-low secondary', temperature(day.min)),
      range,
      el('span', 'day-high', temperature(day.max)),
    )
    item.setAttribute('aria-label', `${i === 0 ? 'Today' : fmt.weekday.format(wallTime(day.date))}: ${words}, low ${temperature(day.min)}, high ${temperature(day.max)}`)
    list.append(item)
  })
  section.append(title, list)
  return section
}

function renderFooter() {
  if (noteTimer) return
  const forecast = state.forecast
  let text = ''
  if (state.loading && forecast) text = 'Updating'
  else if (forecast && state.error === 'offline') text = `Offline. ${updatedText(forecast.fetchedAt)}`
  else if (forecast && state.error) text = `Could not update. ${updatedText(forecast.fetchedAt)}`
  else if (forecast) text = updatedText(forecast.fetchedAt)
  $('updated').textContent = text
  $('retry').hidden = !(forecast && state.error)
}

function message(text, action, onAction) {
  const box = el('div', 'message')
  box.append(el('p', 'secondary', text))
  if (action) {
    const button = el('button', 'quiet', action)
    button.type = 'button'
    button.addEventListener('click', onAction)
    box.append(button)
  }
  return box
}

function iconElement(name, label) {
  const span = el('span', 'icon')
  span.innerHTML = iconSvg(name)
  if (label) {
    span.setAttribute('role', 'img')
    span.setAttribute('aria-label', label)
    span.title = label
  }
  return span
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A short message in the footer, then back to the updated time. */
function note(text) {
  clearTimeout(noteTimer)
  $('updated').textContent = text
  noteTimer = setTimeout(() => {
    noteTimer = null
    renderFooter()
  }, 5000)
}

function tick() {
  if (!deska.visible) return
  if (isStale(state.forecast) && !state.loading && navigator.onLine !== false) refresh()
  else renderFooter()
}

// --- places ------------------------------------------------------------------

function openPlaces() {
  $('now-view').hidden = true
  $('places-view').hidden = false
  renderSaved()
  // Moving focus is fine here: the person just asked for this view.
  $('query').focus()
}

function closePlaces() {
  clearSearch()
  $('places-view').hidden = true
  $('now-view').hidden = false
  $('open-places').focus()
}

function renderSaved() {
  const list = $('saved')
  if (!state.places.length) {
    list.replaceChildren(el('li', 'secondary empty', 'Search above to add a place.'))
    return
  }
  list.replaceChildren(
    ...state.places.map((place) => {
      const item = el('li', 'saved-row')
      const pick = el('button', 'saved-pick')
      pick.type = 'button'
      const active = place.id === state.activeId
      if (active) pick.setAttribute('aria-current', 'true')
      const check = el('span', 'saved-check')
      check.innerHTML = active ? UI_ICONS.check : ''
      const text = el('span', 'saved-text')
      text.append(el('span', 'saved-name', place.name))
      if (place.region) text.append(el('span', 'secondary saved-region', place.region))
      pick.append(check, text)
      pick.addEventListener('click', () => switchTo(place.id))
      const remove = el('button', 'icon-button')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${place.name}`)
      remove.innerHTML = UI_ICONS.remove
      remove.addEventListener('click', () => removePlace(place.id))
      item.append(pick, remove)
      return item
    }),
  )
}

async function switchTo(id) {
  state.activeId = id
  save('activeId', id)
  closePlaces()
  await showActive()
}

async function addPlace(place) {
  if (!state.places.some((p) => p.id === place.id)) {
    if (state.places.length >= MAX_PLACES) {
      $('search-status').textContent = `You can keep ${MAX_PLACES} places. Remove one to add another.`
      return
    }
    state.places = [...state.places, place]
    save('places', state.places)
  }
  await switchTo(place.id)
}

async function removePlace(id) {
  const index = state.places.findIndex((p) => p.id === id)
  state.places = state.places.filter((p) => p.id !== id)
  save('places', state.places)
  forget(cacheKey(id))
  if (state.activeId === id) {
    state.activeId = state.places[0]?.id ?? null
    save('activeId', state.activeId)
    showActive()
  }
  renderSaved()
  // Keep keyboard focus near where it was, since the row it was on is gone.
  const buttons = $('saved').querySelectorAll('.icon-button')
  ;(buttons[Math.min(index, buttons.length - 1)] ?? $('query')).focus()
}

// --- search ------------------------------------------------------------------

function onQueryInput() {
  clearTimeout(searchTimer)
  searchAbort?.abort()
  const query = $('query').value.trim()
  if (query.length < 2) {
    showResults([])
    $('search-status').textContent = ''
    return
  }
  // Wait for a pause in typing before asking the API.
  searchTimer = setTimeout(() => search(query), SEARCH_DELAY_MS)
}

async function search(query) {
  // Each search cancels the one before, so a slow earlier answer can never
  // replace the results for what the person typed last.
  searchAbort?.abort()
  const controller = new AbortController()
  searchAbort = controller
  $('search-status').textContent = 'Searching'
  try {
    const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' })
    const response = await fetch(`${GEOCODE_URL}?${params}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`geocoding ${response.status}`)
    const data = await response.json()
    const results = (data.results ?? []).map(toPlace)
    showResults(results)
    $('search-status').textContent = results.length ? '' : `No places match "${query}".`
  } catch (err) {
    if (controller.signal.aborted) return
    showResults([])
    $('search-status').textContent = navigator.onLine === false ? 'You are offline. Search needs a connection.' : 'Search failed. Try again.'
  }
}

function toPlace(result) {
  const region = [result.admin1, result.country].filter((part, i, all) => part && part !== result.name && all.indexOf(part) === i).join(', ')
  return { id: result.id, name: result.name, region, lat: result.latitude, lon: result.longitude }
}

function showResults(results) {
  state.results = results
  state.highlighted = results.length ? 0 : -1
  const list = $('results')
  list.replaceChildren(
    ...results.map((place, i) => {
      const option = el('li', 'result')
      option.id = `result-${i}`
      option.setAttribute('role', 'option')
      option.append(el('span', 'saved-name', place.name))
      if (place.region) option.append(el('span', 'secondary saved-region', place.region))
      // mousedown would blur the input before click; keep focus in the field.
      option.addEventListener('mousedown', (event) => event.preventDefault())
      option.addEventListener('click', () => addPlace(place))
      return option
    }),
  )
  list.hidden = !results.length
  $('query').setAttribute('aria-expanded', String(results.length > 0))
  highlight(state.highlighted)
}

function highlight(index) {
  state.highlighted = index
  ;[...$('results').children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)))
  if (index >= 0) {
    $('query').setAttribute('aria-activedescendant', `result-${index}`)
    $(`result-${index}`).scrollIntoView({ block: 'nearest' })
  } else {
    $('query').removeAttribute('aria-activedescendant')
  }
}

function onQueryKey(event) {
  const count = state.results.length
  if (event.key === 'ArrowDown' && count) {
    event.preventDefault()
    highlight((state.highlighted + 1) % count)
  } else if (event.key === 'ArrowUp' && count) {
    event.preventDefault()
    highlight((state.highlighted - 1 + count) % count)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if ($('query').value) clearSearch()
    else closePlaces()
  }
}

function onSearchSubmit(event) {
  // The frame's CSP has form-action 'none': a real submit would be refused,
  // so Enter is handled here and nothing navigates.
  event.preventDefault()
  const place = state.results[state.highlighted]
  if (place) addPlace(place)
}

function clearSearch() {
  clearTimeout(searchTimer)
  searchAbort?.abort()
  $('query').value = ''
  $('search-status').textContent = ''
  showResults([])
}

// --- wiring --------------------------------------------------------------------

function setUnits(units) {
  state.units = units
  // Storing the choice means it now wins over the locale on every reload.
  save('units', units)
  render()
}

async function openAttribution() {
  // openUrl needs the open-url permission and the frame's focus, which a
  // click gives. Deska may ask the person first, and they may say no.
  try {
    await deska.openUrl(ATTRIBUTION_URL)
  } catch (err) {
    if (err?.code === 'declined') return
    if (err?.code === 'not_focused') note('Click the link again to open it.')
    else if (err?.code === 'rate_limited') note('One moment, then try again.')
    else note('Could not open the link.')
  }
}

function wire() {
  $('unit-metric').addEventListener('click', () => setUnits('metric'))
  $('unit-imperial').addEventListener('click', () => setUnits('imperial'))
  $('open-places').addEventListener('click', openPlaces)
  $('close-places').addEventListener('click', closePlaces)
  $('retry').addEventListener('click', refresh)
  $('attribution').addEventListener('click', openAttribution)
  $('search').addEventListener('submit', onSearchSubmit)
  $('query').addEventListener('input', onQueryInput)
  $('query').addEventListener('keydown', onQueryKey)
  // Back online, or shown again after a while: bring the forecast up to date.
  window.addEventListener('online', () => {
    if (state.error || isStale(state.forecast)) refresh()
  })
  deska.on('visibility', ({ visible }) => {
    if (visible) tick()
  })
}
