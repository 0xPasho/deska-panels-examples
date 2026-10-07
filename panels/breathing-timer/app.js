/* Breathing Timer: a guide for box breathing, 4-7-8 and slow breaths.
 *
 * What this panel teaches:
 * - One page for two places: the same index.html runs on the desk and inside
 *   Extras (no separate view), with a compact layout when init.place is
 *   'extras'.
 * - A session stored as timestamps, so the desk panel, the Extras view and a
 *   reload all agree on where the breath is without talking to each other.
 * - Extras: `until` lets Deska count down with no frame alive, and the row's
 *   round control starts, pauses and resumes the session.
 * - Motion that respects prefers-reduced-motion: the orb stops growing and a
 *   plain bar and count take over. */

import { PATTERNS, breath, clock, elapsed, idle, patternById, paused, read, running, total } from './session.js'
import { problemText, showStatus, snapThemeChanges } from './kit.js'

const KEY = 'session'
const $ = (id) => document.getElementById(id)
const reduced = matchMedia('(prefers-reduced-motion: reduce)')

let session = idle()
let frame = null
let timer = null
let lastPhase = null
let lastExtras = ''

snapThemeChanges()
const init = await deska.ready()
document.body.classList.toggle('in-extras', init.place === 'extras')
$('pattern').replaceChildren(...PATTERNS.map((p) => new Option(p.name, p.id)))

await pull()
$('app').setAttribute('aria-busy', 'false')
schedule()

// Storage is the session --------------------------------------------------------------

async function pull() {
  try {
    session = read(await deska.storage.get(KEY))
  } catch (err) {
    showStatus(problemText(err, 'load the session'), 'error')
  }
}

async function push(next) {
  session = next
  render(Date.now())
  try {
    await deska.storage.set(KEY, session)
  } catch (err) {
    showStatus(`Not saved. ${problemText(err, 'save')}`, 'error')
  }
  syncExtras(Date.now())
}

// Actions -------------------------------------------------------------------------------

function start() {
  const now = Date.now()
  if (paused(session)) {
    push({ ...session, pausedMs: session.pausedMs + (now - session.pausedAt), pausedAt: null })
  } else if (!running(session)) {
    warmChime()
    push({ ...session, startedAt: now, pausedAt: null, pausedMs: 0, doneAt: null })
  }
}

function pause() {
  if (running(session)) push({ ...session, pausedAt: Date.now() })
}

function end(finished) {
  const now = Date.now()
  push({ ...idle(session.pattern, session.minutes), doneAt: finished ? now : null, chimed: finished ? session.startedAt : session.chimed })
}

$('toggle').addEventListener('click', () => (running(session) ? pause() : start()))
$('stop').addEventListener('click', () => end(false))
$('pattern').addEventListener('change', () => push({ ...session, pattern: $('pattern').value }))
$('minutes').addEventListener('change', () => push({ ...session, minutes: Number($('minutes').value) }))

// The round control on the Extras row. Every frame of the package hears it;
// the session in storage makes the answer the same in each.
deska.on('extras.control', async ({ control }) => {
  await pull()
  if (control === 'start' || control === 'play') start()
  else if (control === 'pause') pause()
  else if (control === 'stop') end(false)
})

// Space toggles, Escape ends, like a media player.
addEventListener('keydown', (event) => {
  if (event.target.closest('select')) return
  if (event.key === ' ' && event.target === document.body) {
    event.preventDefault()
    running(session) ? pause() : start()
  } else if (event.key === 'Escape' && session.startedAt !== null) {
    end(false)
  }
})

// Drawing ---------------------------------------------------------------------------------

function render(now) {
  const isRunning = running(session)
  const isPaused = paused(session)
  const active = isRunning || isPaused
  const done = active && elapsed(session, now) >= total(session)
  if (done && isRunning) {
    finish()
    return
  }

  $('pattern').value = session.pattern
  $('minutes').value = String(session.minutes)
  $('pattern').disabled = active
  $('minutes').disabled = active
  $('toggle').textContent = isRunning ? 'Pause' : isPaused ? 'Resume' : 'Start'
  $('stop').hidden = !active
  document.body.classList.toggle('is-running', isRunning)
  document.body.classList.toggle('is-active', active)

  if (!active) {
    $('orb').style.setProperty('--s', '0')
    $('bar-fill').style.setProperty('--p', '0')
    $('phase').textContent = session.doneAt ? 'Nicely done' : 'Ready when you are'
    $('count').textContent = session.doneAt ? `${session.minutes} ${session.minutes === 1 ? 'minute' : 'minutes'} of calm breathing` : patternById(session.pattern).name
    $('left').textContent = clock(total(session))
    lastPhase = null
    return
  }

  const b = breath(session, now)
  $('orb').style.setProperty('--s', b.scale.toFixed(4))
  $('bar-fill').style.setProperty('--p', b.progress.toFixed(4))
  $('phase').textContent = isPaused ? 'Paused' : b.word
  $('count').textContent = isPaused ? 'Press Resume to carry on' : String(b.secondsLeft)
  $('left').textContent = `${clock(total(session) - elapsed(session, now))} left`
  if (isRunning && b.phase !== lastPhase) {
    $('announce').textContent = b.word
    lastPhase = b.phase
  }
}

let finishing = false
async function finish() {
  if (finishing) return
  finishing = true
  // Several frames may notice the end at once; the stored `chimed` keeps the
  // chime to one.
  await pull()
  finishing = false
  if (!running(session) || elapsed(session, Date.now()) < total(session)) return render(Date.now())
  const startedAt = session.startedAt
  const shouldChime = session.chimed !== startedAt && deska.visible
  end(true)
  if (shouldChime) chime()
}

// Loop: every animation frame while visible and running (the orb), else once
// a second (the clock), else every 15 s when hidden (to finish on time and
// keep Extras right). Frames do not talk to each other: re-reading storage
// every couple of seconds picks up what another frame changed.
let pulls = 0
function schedule() {
  cancelAnimationFrame(frame)
  clearTimeout(timer)
  const now = Date.now()
  render(now)
  syncExtras(now)
  if (deska.visible && running(session) && !reduced.matches) {
    frame = requestAnimationFrame(schedule)
    if (++pulls % 120 === 0) pull()
    return
  }
  const wait = deska.visible ? 1000 - (now % 1000) + 5 : 15_000
  timer = setTimeout(async () => {
    if (++pulls % 2 === 0 || !deska.visible) await pull()
    schedule()
  }, wait)
}

deska.on('visibility', schedule)
reduced.addEventListener('change', schedule)

// Extras ------------------------------------------------------------------------------------

function syncExtras(now) {
  const pattern = patternById(session.pattern)
  let fields
  if (running(session)) {
    fields = { state: pattern.short, until: now + total(session) - elapsed(session, now), progress: round(elapsed(session, now) / total(session)), control: 'pause' }
  } else if (paused(session)) {
    fields = { state: `${pattern.short}, paused with ${clock(total(session) - elapsed(session, now))} left`, until: null, progress: round(elapsed(session, now) / total(session)), control: 'play' }
  } else {
    fields = { state: session.doneAt ? `Done, ${session.minutes} min of breathing` : `${pattern.short}, ${session.minutes} min`, until: null, progress: null, control: 'start' }
  }
  // Only call when something a person would see changed: until keeps
  // counting on Deska's side, and progress moves in 2% steps.
  const key = JSON.stringify({ ...fields, until: fields.until && Math.round(fields.until / 1000) })
  if (key === lastExtras) return
  lastExtras = key
  deska.extras.set(fields).catch((err) => console.warn(`extras.set failed: ${err.code}`))
}

function round(x) {
  return Math.min(1, Math.max(0, Math.round(x * 50) / 50))
}

// A soft chime at the end -------------------------------------------------------------------

let audio = null
function warmChime() {
  // An AudioContext may only start from a person's click, so make it on Start.
  try {
    audio = audio || new AudioContext()
    audio.resume()
  } catch {
    audio = null
  }
}

function chime() {
  if (!audio) return
  const t = audio.currentTime
  for (const [freq, delay] of [[528, 0], [792, 0.18]]) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t + delay)
    gain.gain.linearRampToValueAtTime(0.12, t + delay + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 2.2)
    osc.connect(gain).connect(audio.destination)
    osc.start(t + delay)
    osc.stop(t + delay + 2.3)
  }
}
