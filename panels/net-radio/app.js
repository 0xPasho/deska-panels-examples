/* Net Radio: a listener for SomaFM's listener supported internet radio.
 * Pick a station from SomaFM's live list, star the ones you like, and keep
 * it playing while you work. The track now playing shows under the station.
 *
 * What this panel teaches
 * - media-src: an <audio> element streams from hosts declared in `network`,
 *   with no CORS needed (startStream, STREAM_HOSTS).
 * - The Extras place: deska.extras.set for the row's state and control, and
 *   deska.on('extras.control') to play or pause from it (syncExtras).
 * - deska.place to draw a compact layout inside Extras, and deska.visible to
 *   pause cosmetic polling but never the audio (pollTrack).
 * - Autoplay refusal, buffering and stream errors as designed states, plus
 *   deska.storage for favorites, the last station and the volume.
 */

import { loadStations, streamCandidates, latestTrack } from './somafm.js'

const SUPPORT_URL = 'https://somafm.com/support/'
const TRACK_EVERY_MS = 30_000
const CONNECT_TIMEOUT_MS = 12_000
const VOLUME_SAVE_DELAY_MS = 400

const $ = (id) => document.getElementById(id)
// A logo that fails to load becomes a transparent pixel over the quiet
// placeholder box, never a broken image icon.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
const blankOnError = (img) => img.addEventListener('error', () => img.src !== BLANK && (img.src = BLANK))
blankOnError($('cover'))
const audio = new Audio()
audio.preload = 'none'

const state = {
  stations: [],
  favorites: [],
  station: null, // the chosen station, playing or not
  phase: 'idle', // idle, ready, connecting, buffering, playing, blocked, error
  track: '',
  query: '',
  offline: !navigator.onLine,
  cached: false,
}
let candidates = []
let attempt = 0 // bumps on every play or stop, so a slow lookup cannot restart a stopped stream
let connectTimer = 0
let trackTimer = 0
let pollSeq = 0 // only the newest track lookup may write the track line
let volumeTimer = 0
const TEXT_MAX = 60 // setTitle and the Extras state refuse longer text (invalid_args)
let panelName = 'Net Radio' // from init; setTitle has no "clear", so the name stands for no title
const sent = { extras: '', title: undefined } // skip bridge calls that would change nothing

// --- storage ------------------------------------------------------------------

// deska.storage is the only storage that survives: the frame has an opaque
// origin, so localStorage throws. Every write can fail (storage_full when the
// package's 256 KB are used up), so failures are logged, never thrown at the person.
async function save(key, value) {
  try {
    await deska.storage.set(key, value)
  } catch (err) {
    console.warn(`Net Radio could not save ${key}: ${err.code || err.message}`)
  }
}

async function restore() {
  // The panel can reload at any time (moved, docked, restarted), so
  // everything the person chose comes back from storage.
  const [favorites, last, volume, cache] = await Promise.all(
    ['favorites', 'last', 'volume', 'stations'].map((key) => deska.storage.get(key).catch(() => null)),
  )
  state.favorites = Array.isArray(favorites) ? favorites : []
  audio.volume = typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 0.8
  $('volume').value = String(audio.volume)
  if (Array.isArray(cache)) state.stations = cache
  return last && typeof last === 'object' ? last : null
}

// --- stations -----------------------------------------------------------------

async function refreshStations() {
  try {
    state.stations = await loadStations()
    state.cached = false
    // A trimmed copy lets the list open offline next time.
    save('stations', state.stations.map((s) => ({ ...s, listeners: 0 })))
  } catch {
    state.cached = state.stations.length > 0
    if (!state.cached) throw new Error('stations')
  }
}

const findStation = (id) => state.stations.find((s) => s.id === id) || null

// --- playback -----------------------------------------------------------------

async function startStream(station, { fresh = true } = {}) {
  const mine = attempt
  if (fresh) candidates = await streamCandidates(station)
  if (mine !== attempt) return
  const url = candidates.shift()
  if (!url) return setPhase('error')
  // The stream host must be in panel.json's network list: Deska's media-src
  // only allows declared hosts. An <audio> element needs no CORS headers.
  audio.src = url
  setPhase('connecting')
  clearTimeout(connectTimer)
  connectTimer = setTimeout(() => nextHost(), CONNECT_TIMEOUT_MS)
  try {
    await audio.play()
  } catch (err) {
    clearTimeout(connectTimer)
    // Browsers refuse play() without a click (NotAllowedError). That is a
    // normal state, not an error: show the Play button and wait.
    if (err.name === 'NotAllowedError') return stopStream('blocked')
    // AbortError means a newer src replaced this one; the newer call reports.
    if (err.name !== 'AbortError') nextHost()
  }
}

function nextHost() {
  clearTimeout(connectTimer)
  if (!state.station || !['connecting', 'buffering', 'playing'].includes(state.phase)) return
  if (candidates.length) startStream(state.station, { fresh: false })
  else stopStream('error')
}

// A live stream has nothing to resume: pausing would replay stale audio and
// keep downloading. Stopping drops the connection; Play reconnects live.
function stopStream(phase = 'ready') {
  attempt += 1
  clearTimeout(connectTimer)
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  setPhase(phase)
}

function play(station = state.station) {
  if (!station) return
  const changed = station !== state.station
  state.station = station
  if (changed) state.track = ''
  save('last', { id: station.id, playing: true })
  attempt += 1
  setPhase('connecting')
  startStream(station)
}

function stop() {
  stopStream('ready')
  if (state.station) save('last', { id: state.station.id, playing: false })
}

const isLive = () => ['connecting', 'buffering', 'playing'].includes(state.phase)
const toggle = () => (isLive() ? stop() : play())

audio.addEventListener('playing', () => {
  clearTimeout(connectTimer)
  setPhase('playing')
})
audio.addEventListener('waiting', () => isLive() && setPhase('buffering'))
audio.addEventListener('error', () => {
  // removeAttribute('src') in stopStream fires an error with no source: ignore it.
  if (audio.getAttribute('src')) nextHost()
})

function setPhase(phase) {
  state.phase = phase
  render()
  syncExtras()
  syncTitle()
  pollTrack()
}

// --- now playing --------------------------------------------------------------

async function pollTrack() {
  clearTimeout(trackTimer)
  const mine = ++pollSeq
  if (!state.station || state.phase !== 'playing') return
  // Hidden is not a reason to stop the music, only the cosmetic polling:
  // nobody is looking at the track line. The 'visibility' listener restarts it.
  if (deska.visible) {
    const station = state.station
    const track = await latestTrack(station.id)
    if (mine !== pollSeq) return // a newer poll took over while this one waited
    if (track !== null) {
      state.track = track
      renderPlayer()
    }
  }
  trackTimer = setTimeout(pollTrack, TRACK_EVERY_MS)
}

// --- Deska: Extras, title, visibility ------------------------------------------

/** Station names come from SomaFM: shorten them so name plus suffix fits. */
function fit(name, suffix = '') {
  const room = TEXT_MAX - suffix.length
  const short = name.length > room ? `${name.slice(0, room - 1).trimEnd()}…` : name
  return short + suffix
}

function syncExtras() {
  const s = state.station
  const states = {
    connecting: 'connecting',
    buffering: 'buffering',
    blocked: 'press play',
    error: 'not answering',
    ready: 'stopped',
  }
  const suffix = states[state.phase]
  const fields = {
    state: s ? fit(s.title, suffix ? `, ${suffix}` : '') : 'Pick a station',
    control: s ? (isLive() ? 'pause' : 'play') : null,
  }
  if (JSON.stringify(fields) === sent.extras) return
  sent.extras = JSON.stringify(fields)
  // The Extras row shows one state line and one round control. Deska keeps
  // them after the frame closes, so they must always describe the real state.
  deska.extras
    .set(fields)
    .catch((err) => console.warn(`Net Radio could not update Extras: ${err.code}`))
}

function syncTitle() {
  // The canvas shows "Net Radio: <title>". Deska refuses null, '' and text
  // over 60 characters, so stopping sets the panel's own name back.
  const title = isLive() && state.station ? fit(state.station.title) : panelName
  if (title === sent.title) return
  sent.title = title
  // setTitle reads under the panel's name on the canvas: "Net Radio: Groove Salad".
  deska.setTitle(title).catch((err) => console.warn(`Net Radio could not set its title: ${err.code}`))
}

// --- rendering ----------------------------------------------------------------

const STATUS = {
  idle: '',
  ready: 'Ready to play',
  connecting: 'Connecting',
  buffering: 'Buffering',
  blocked: 'Press play to start listening',
  error: 'This station is not answering right now.',
}

function renderPlayer() {
  const s = state.station
  const cover = $('cover')
  cover.hidden = !s
  $('cover-empty').hidden = !!s
  if (s && cover.dataset.station !== s.id) {
    cover.dataset.station = s.id
    cover.src = s.image || BLANK
  }
  $('station').textContent = s ? s.title : state.stations.length ? 'Pick a station' : 'Loading stations'
  const track = s && state.phase === 'playing' ? state.track || s.genre : s ? s.genre : ''
  $('track').textContent = track
  $('track').title = track // the line ellipsizes; hover shows all of it
  const status = state.phase === 'playing' ? (s.listeners ? `Live, ${s.listeners.toLocaleString()} listening` : 'Live') : STATUS[state.phase]
  $('status').textContent = state.offline && !isLive() ? 'You are offline' : status
  $('status').dataset.tone = state.phase === 'error' ? 'danger' : ''
  const live = isLive()
  const button = $('play')
  button.disabled = !s
  button.classList.toggle('is-live', live)
  button.setAttribute('aria-label', live ? `Pause ${s.title}` : s ? `Play ${s.title}` : 'Play')
  $('retry').hidden = state.phase !== 'error'
  $('page').hidden = !s
  document.body.dataset.phase = state.phase
}

function rowFor(station) {
  const row = $('row').content.firstElementChild.cloneNode(true)
  const pick = row.querySelector('.pick')
  const thumb = row.querySelector('.thumb')
  blankOnError(thumb)
  thumb.src = station.image || BLANK
  row.querySelector('.row-title').textContent = station.title
  row.querySelector('.row-meta').textContent = station.listeners
    ? `${station.genre}, ${station.listeners.toLocaleString()} listening`
    : station.genre
  row.querySelector('.row-desc').textContent = station.description
  const current = station === state.station
  row.classList.toggle('is-current', current)
  pick.setAttribute('aria-current', current ? 'true' : 'false')
  pick.setAttribute('aria-label', `${current && isLive() ? 'Playing' : 'Play'} ${station.title}`)
  pick.addEventListener('click', () => (current && isLive() ? undefined : play(station)))
  const star = row.querySelector('.star')
  star.dataset.id = station.id
  const starred = state.favorites.includes(station.id)
  star.setAttribute('aria-pressed', String(starred))
  star.setAttribute('aria-label', starred ? `Remove ${station.title} from favorites` : `Add ${station.title} to favorites`)
  star.addEventListener('click', () => toggleFavorite(station.id))
  return row
}

function matches(station) {
  const q = state.query.trim().toLowerCase()
  return !q || `${station.title} ${station.genre} ${station.description}`.toLowerCase().includes(q)
}

function renderLists() {
  const visible = state.stations.filter(matches)
  const favorites = state.favorites.map(findStation).filter((s) => s && matches(s))
  const rest = visible.filter((s) => !favorites.includes(s))
  $('favorites').replaceChildren(...favorites.map(rowFor))
  $('stations').replaceChildren(...rest.map(rowFor))
  $('favorites-section').hidden = favorites.length === 0
  $('all-section').hidden = rest.length === 0
  $('all-heading').textContent = favorites.length ? 'All stations' : 'Stations'
  const empty = $('empty')
  empty.hidden = state.stations.length === 0 || favorites.length + rest.length > 0
  empty.textContent = `No station matches “${state.query.trim()}”.`
}

function renderNotice() {
  const notice = $('notice')
  const text = state.offline
    ? state.stations.length
      ? 'You are offline. Stations play again once the connection is back.'
      : 'You are offline. The station list loads once the connection is back.'
    : state.cached
      ? 'Showing the stations saved last time. SomaFM did not answer.'
      : ''
  notice.textContent = text
  notice.hidden = !text
}

function render() {
  renderPlayer()
  renderLists()
  renderNotice()
}

// --- actions ------------------------------------------------------------------

function toggleFavorite(id) {
  const had = state.favorites.includes(id)
  state.favorites = had ? state.favorites.filter((f) => f !== id) : [...state.favorites, id]
  save('favorites', state.favorites)
  renderLists()
  // Re-rendering replaced the row: put focus back on the same star, a move
  // the person's own click asked for.
  ;(document.querySelector(`.star[data-id="${id}"]`) || $('search')).focus()
}

async function open(url) {
  // openUrl needs the open-url permission and the frame's focus, which a
  // click gives. Deska asks the person the first time for each host.
  try {
    await deska.openUrl(url)
  } catch (err) {
    if (err.code === 'declined') return // the person said no; nothing to explain
    if (err.code === 'not_focused') return showNotice('Click the panel first, then open the link again.')
    showNotice('Deska could not open the link.')
  }
}

function showNotice(text) {
  const notice = $('notice')
  notice.textContent = text
  notice.hidden = false
}

async function loadList() {
  $('station').textContent = 'Loading stations'
  try {
    await refreshStations()
  } catch {
    $('station').textContent = state.offline ? 'You are offline' : 'SomaFM did not answer'
    $('status').textContent = ''
    $('retry').hidden = false
    $('retry').dataset.action = 'list'
    $('app').setAttribute('aria-busy', 'false')
    return false
  }
  $('retry').dataset.action = ''
  $('app').setAttribute('aria-busy', 'false')
  if (state.station) state.station = findStation(state.station.id) || state.station
  render()
  return true
}

function wire() {
  $('play').addEventListener('click', toggle)
  $('retry').addEventListener('click', async () => {
    if ($('retry').dataset.action === 'list') {
      $('retry').hidden = true
      if ((await loadList()) && !state.station) render()
      return
    }
    play()
  })
  $('support').addEventListener('click', () => open(SUPPORT_URL))
  $('page').addEventListener('click', () => state.station && open(`https://somafm.com/${state.station.id}/`))
  $('search-form').addEventListener('submit', (e) => e.preventDefault()) // form-action is 'none'
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value
    renderLists()
  })
  $('volume').addEventListener('input', (e) => {
    audio.volume = Number(e.target.value)
    // Bridge calls are limited to 20 a second: save once the slider settles.
    clearTimeout(volumeTimer)
    volumeTimer = setTimeout(() => save('volume', audio.volume), VOLUME_SAVE_DELAY_MS)
  })
  addEventListener('offline', () => {
    state.offline = true
    render()
  })
  addEventListener('online', () => {
    state.offline = false
    if (state.phase === 'error') play()
    if (!state.stations.length || state.cached) loadList()
    else render()
  })

  // The round control on the Extras row arrives here, even when the panel
  // itself is not on screen.
  deska.on('extras.control', ({ control }) => {
    if (control === 'pause' || control === 'stop') stop()
    else if (control === 'play' || control === 'start') play()
  })
  // Visibility only resumes the track line; the audio keeps going either way.
  deska.on('visibility', () => pollTrack())
  // When the frame goes away the music stops with it. Leave the Extras row
  // saying so (best effort: the page may be gone before the message lands).
  addEventListener('pagehide', () => {
    if (isLive()) {
      state.phase = 'ready'
      syncExtras()
    }
  })
}

async function main() {
  const init = await deska.ready()
  panelName = (init.panel?.name || panelName).slice(0, TEXT_MAX)
  // Inside the Extras popover the same page draws a compact layout (app.css,
  // [data-place="extras"]): no search, no descriptions, smaller art.
  document.body.dataset.place = deska.place
  wire()
  const last = await restore()
  if (state.stations.length) render()
  await loadList()
  // First run: offer the busiest station, ready but silent.
  const station = (last && findStation(last.id)) || state.stations[0] || null
  if (!station) return
  state.station = station
  setPhase('ready')
  // It was playing before the panel reloaded: try to carry on. The browser
  // may refuse without a click, which lands in the blocked state.
  if (last?.playing) play(station)
}

main()
