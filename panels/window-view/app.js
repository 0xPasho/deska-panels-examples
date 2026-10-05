/* Window View
 * A calm window on the desk: short looping nature scenes from Wikimedia
 * Commons, muted, with the credit each license asks for.
 *
 * What this panel teaches
 * - deska.ready() visibility and deska.on('visibility'): the video only plays
 *   while someone can see it and is at the computer (saves CPU and battery).
 * - media-src from a declared host: <video> and its poster stream from
 *   upload.wikimedia.org, the one host listed in panel.json "network".
 * - deska.openUrl from a click, handled by its error codes, for attribution.
 * - deska.storage, so a reload comes back to the same scene.
 */

const KEY = 'window-view:v1'
const ANNOUNCE_MS = 3500
const NOTE_MS = 4000

const $ = (id) => document.getElementById(id)
const els = {
  app: $('app'),
  video: $('video'),
  overlay: $('overlay'),
  title: $('title'),
  credit: $('credit'),
  note: $('note'),
  prev: $('prev'),
  next: $('next'),
  toggle: $('toggle'),
  openCredit: $('open-credit'),
  message: $('message'),
  messageText: $('message-text'),
  retry: $('retry'),
}

const state = {
  videos: [],
  index: 0,
  direction: 1,
  // The person's own pause. Kept apart from "not visible" so a scene they
  // paused stays paused when the panel comes back into view.
  userPaused: false,
  visible: true,
  idle: false,
  failed: new Set(),
}

let announceTimer = 0
// The panel's own name, from init: what setTitle shows when no scene is on screen.
let PANEL_NAME = 'Window View'
let noteTimer = 0

const current = () => state.videos[state.index]

function shouldPlay() {
  return state.visible && !state.idle && !state.userPaused && navigator.onLine
}

const MESSAGES = {
  error: 'None of the scenes would load.',
  offline: 'You are offline. The window opens again when you are back.',
}

function setView(view) {
  els.app.dataset.state = view
  els.app.setAttribute('aria-busy', String(view === 'loading'))
  // Before the list arrives there is no caption to show yet, only a quiet word.
  const listLoading = view === 'loading' && !state.videos.length
  const message = view in MESSAGES || listLoading
  els.message.hidden = !message
  els.overlay.hidden = message
  els.retry.hidden = listLoading
  els.messageText.textContent = listLoading ? 'Loading' : MESSAGES[view] || ''
  // No scene on screen: go back to the panel's own name rather than name one
  // that is not showing (Deska has no empty title; its own name shows alone).
  if (view in MESSAGES) deska.setTitle(PANEL_NAME).catch((err) => console.warn('[window-view] setTitle:', err.code))
}

function showNote(text) {
  clearTimeout(noteTimer)
  els.note.textContent = text
  if (text) noteTimer = setTimeout(() => (els.note.textContent = ''), NOTE_MS)
}

// Shows the caption for a moment when a scene starts, then lets the view be.
function announce() {
  clearTimeout(announceTimer)
  els.app.classList.add('announcing')
  announceTimer = setTimeout(() => els.app.classList.remove('announcing'), ANNOUNCE_MS)
}

function renderCaption() {
  const v = current()
  els.title.textContent = v.title
  els.credit.textContent = `${v.author}, ${v.license}`
  els.openCredit.setAttribute('aria-label', `Credit: open the file page for ${v.title}`)
  els.app.classList.toggle('user-paused', state.userPaused)
  const label = state.userPaused ? 'Play' : 'Pause'
  els.toggle.setAttribute('aria-label', label)
  els.toggle.title = label
}

/* Playback follows one rule: play when shouldPlay(), pause otherwise. Every
 * change (visibility, idle, the person's pause, the network) calls sync(). */
function sync() {
  const video = els.video
  if (!shouldPlay()) {
    if (!video.paused) video.pause()
    return
  }
  if (!video.paused) return
  video.play().catch((err) => {
    // AbortError: a new src replaced this one before it started.
    // NotSupportedError: the source failed; the video's 'error' event skips it.
    if (err.name !== 'AbortError' && err.name !== 'NotSupportedError') console.warn('[window-view] play failed:', err.name)
  })
}

function load(index, { announceIt = true } = {}) {
  state.index = (index + state.videos.length) % state.videos.length
  const v = current()
  setView('loading')
  renderCaption()
  // Both URLs live on upload.wikimedia.org, which panel.json declares, so the
  // panel's media-src and img-src let them through. Any other host is blocked.
  els.video.poster = v.poster
  els.video.src = v.src
  if (announceIt) announce()
  // setTitle names the scene under the panel's name on the canvas.
  deska.setTitle(v.title).catch((err) => console.warn('[window-view] setTitle:', err.code))
  save()
  sync()
}

function step(direction) {
  state.direction = direction
  showNote('')
  load(state.index + direction)
}

// A scene that fails to load is skipped in the direction the person was going.
function onVideoError() {
  if (!navigator.onLine) return setView('offline')
  state.failed.add(state.index)
  if (state.failed.size >= state.videos.length) return setView('error')
  showNote('That scene would not load, so here is the next one.')
  let index = state.index
  do index = (index + state.direction + state.videos.length) % state.videos.length
  while (state.failed.has(index))
  load(index)
}

function retry() {
  if (!state.videos.length) return show()
  state.failed.clear()
  els.video.removeAttribute('src')
  load(state.index)
}

function save() {
  // deska.storage, not localStorage: the frame has an opaque origin, so web
  // storage throws. One small JSON value per package is all this needs.
  const v = current()
  deska.storage.set(KEY, { page: v.page, userPaused: state.userPaused }).catch((err) => {
    console.warn('[window-view] could not save:', err.code)
  })
}

async function restore() {
  try {
    const saved = await deska.storage.get(KEY)
    if (!saved || typeof saved !== 'object') return null
    return saved
  } catch (err) {
    console.warn('[window-view] could not read saved scene:', err.code)
    return null
  }
}

async function openCredit() {
  // openUrl needs the "open-url" permission and the frame's focus, which a
  // click gives. The first time, Deska asks before opening the host.
  try {
    await deska.openUrl(current().page)
  } catch (err) {
    const code = err.code || err.message
    if (code === 'not_focused') showNote('Click the panel, then Credit again.')
    else if (code === 'rate_limited') showNote('One moment, then try again.')
    else if (code === 'declined') showNote('')
    else showNote('Could not open the file page.')
  }
}

function togglePause() {
  state.userPaused = !state.userPaused
  renderCaption()
  save()
  sync()
}

function onKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (!els.message.hidden || !state.videos.length) return
  if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
  else if (event.key === 'k' || event.key === 'K') togglePause()
  else return
  event.preventDefault()
}

function wire() {
  const video = els.video
  video.addEventListener('playing', () => {
    state.failed.delete(state.index)
    setView('ready')
  })
  video.addEventListener('loadeddata', () => {
    if (els.app.dataset.state === 'loading') setView('ready')
  })
  video.addEventListener('error', onVideoError)

  els.prev.addEventListener('click', () => step(-1))
  els.next.addEventListener('click', () => step(1))
  els.toggle.addEventListener('click', togglePause)
  els.openCredit.addEventListener('click', openCredit)
  els.retry.addEventListener('click', retry)
  document.addEventListener('keydown', onKey)

  // The panel pauses on its own when the network drops, and picks up again.
  window.addEventListener('offline', () => {
    if (els.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) setView('offline')
  })
  window.addEventListener('online', () => {
    if (els.app.dataset.state === 'offline') retry()
    else sync()
  })

  // Deska says when the panel scrolls off screen, sits behind a far view card,
  // lands on a hidden worktree, or when the person steps away (idle). A frame
  // keeps running in all of those, so pausing is the panel's job.
  deska.on('visibility', ({ visible, idle }) => {
    state.visible = visible
    state.idle = idle
    sync()
  })
}

async function loadVideos() {
  const res = await fetch('videos.json')
  if (!res.ok) throw new Error(`videos.json: ${res.status}`)
  const { videos } = await res.json()
  return videos
}

async function start() {
  // ready() resolves with the init payload. Read visibility from it before
  // the first play(): a panel can start hidden (restored off screen) or with
  // the person already idle, and no 'visibility' event will say so.
  const init = await deska.ready()
  PANEL_NAME = init.panel.name
  state.visible = init.visibility.visible
  state.idle = init.visibility.idle

  wire()
  show()
}

// Loads the list and the saved scene, then opens the window. Retry comes back here
// when the list itself failed.
async function show() {
  setView('loading')
  try {
    state.videos = await loadVideos()
  } catch (err) {
    console.warn('[window-view]', err.message)
    setView('error')
    return
  }

  const saved = await restore()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // With reduced motion asked for and no choice saved, start on the still poster.
  state.userPaused = saved ? saved.userPaused === true : reduceMotion
  const savedIndex = saved ? state.videos.findIndex((v) => v.page === saved.page) : -1
  state.index = Math.max(savedIndex, 0)

  if (!navigator.onLine) {
    renderCaption()
    setView('offline')
    return
  }
  load(state.index)
}

start()
