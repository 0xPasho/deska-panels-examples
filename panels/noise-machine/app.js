// Noise Machine: focus sounds generated in the page with the Web Audio API
// (white, pink and brown noise, rain, a fan). Mix several, set a master
// volume and a sleep timer that fades out softly, and play or pause from the
// Extras row.
//
// What this panel teaches:
// - Audio with zero network: Web Audio inside the sandbox, and an
//   AudioContext that starts suspended until the person presses Play.
// - Extras: deska.extras.set({ state, control, until }) and
//   deska.on('extras.control'), with deska.place === 'extras' for a compact view.
// - Visibility: sound keeps playing while deska.visible is false, but the
//   level meter stops drawing.
// - deska.storage as the one shared state between every frame of the package.

import { SOUNDS, SLEEP_FADE_SECONDS, createEngine } from './engine.js'

const $ = (id) => document.getElementById(id)

const MIX_KEY = 'mix'
const SPEAKER_KEY = 'speaker'
const SYNC_MS = 1000
// The speaker renews its lease every sync. A frame that goes away (reloaded,
// closed) cannot reliably say so, so a short lease lets the next one take over.
const LEASE_MS = 3000
const SAVE_DELAY_MS = 150

const DEFAULT_MIX = {
  sounds: {
    white: { on: false, volume: 0.4 },
    pink: { on: false, volume: 0.45 },
    brown: { on: true, volume: 0.6 },
    rain: { on: true, volume: 0.4 },
    fan: { on: false, volume: 0.5 },
  },
  master: 0.7,
  playing: false,
  sleepMinutes: 0,
  sleepEnd: null,
  rev: 0,
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const frameId = Math.random().toString(36).slice(2)

let mix = structuredClone(DEFAULT_MIX)
let compact = false
let engine = null
let isSpeaker = false
let speakerAlive = false
let blocked = false
let saveFailed = false
let saveTimer = 0
let meterFrame = 0
let lastExtras = ''

// ---------------------------------------------------------------- bridge --

/** Runs a bridge call and returns { ok, value } or { ok: false, code }. */
async function bridge(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (err) {
    // The SDK rejects with an Error whose message (and .code) is the bridge code.
    return { ok: false, code: err?.code || err?.message || 'host_error' }
  }
}

function normalize(stored) {
  if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_MIX)
  const clamp = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d)
  const sounds = {}
  for (const { id } of SOUNDS) {
    const s = stored.sounds?.[id] || {}
    sounds[id] = { on: s.on === true, volume: clamp(s.volume, DEFAULT_MIX.sounds[id].volume) }
  }
  return {
    sounds,
    master: clamp(stored.master, DEFAULT_MIX.master),
    playing: stored.playing === true,
    sleepMinutes: [0, 15, 30, 60].includes(stored.sleepMinutes) ? stored.sleepMinutes : 0,
    sleepEnd: typeof stored.sleepEnd === 'number' ? stored.sleepEnd : null,
    rev: typeof stored.rev === 'number' ? stored.rev : 0,
  }
}

// Every frame of this package (a desk panel, the Extras popover, a copy in
// another project) reads and writes the same storage keys, so the mix lives
// there and each frame polls it. The newest `rev` wins.
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const result = await bridge(deska.storage.set(MIX_KEY, mix))
    if (result.ok) {
      if (saveFailed) {
        saveFailed = false
        renderNotice()
      }
      return
    }
    if (result.code === 'rate_limited') return save()
    saveFailed = true
    renderNotice()
    if (result.code !== 'storage_full') console.warn('Noise Machine: could not save the mix:', result.code)
  }, SAVE_DELAY_MS)
}

async function sync() {
  const [stored, speaker] = await Promise.all([bridge(deska.storage.get(MIX_KEY)), bridge(deska.storage.get(SPEAKER_KEY))])
  if (stored.ok && stored.value && stored.value.rev > mix.rev) apply(normalize(stored.value))
  if (speaker.ok) await leadOrFollow(speaker.value)
  if (mix.playing && mix.sleepEnd && Date.now() >= mix.sleepEnd) commit({ playing: false, sleepEnd: null })
  renderStatus()
  renderNotice()
}

// Only one frame makes sound: the speaker. Without this, an open panel and
// the Extras popover would both play, and both answer extras.control. The
// speaker holds a lease in storage and renews it; the popover never plays,
// because it closes with the popover.
async function leadOrFollow(speaker) {
  const now = Date.now()
  const fresh = speaker && typeof speaker.at === 'number' && now - speaker.at < LEASE_MS
  speakerAlive = Boolean(fresh)
  if (compact) return
  if (!fresh || speaker.id === frameId) await claimSpeaker()
  else setSpeaker(false)
}

async function claimSpeaker() {
  const result = await bridge(deska.storage.set(SPEAKER_KEY, { id: frameId, at: Date.now() }))
  if (!result.ok) return
  speakerAlive = true
  setSpeaker(true)
}

function setSpeaker(next) {
  if (next === isSpeaker) return
  isSpeaker = next
  if (isSpeaker && mix.playing) startSound()
  if (!isSpeaker) engine?.stop()
  render()
}

// --------------------------------------------------------------- the mix --

/** A local change: bump the revision, apply it and save it for other frames. */
function commit(changes) {
  apply({ ...mix, ...changes, rev: Math.max(Date.now(), mix.rev + 1) })
  save()
}

function apply(next) {
  const wasPlaying = mix.playing
  const sleepChanged = next.sleepEnd !== mix.sleepEnd
  mix = next
  applyLevels()
  if (isSpeaker) {
    if (mix.playing && (!wasPlaying || !engine?.running)) startSound()
    else if (!mix.playing && wasPlaying) engine?.stop()
    else if (mix.playing && sleepChanged) engine?.shapeFade(mix.sleepEnd)
  }
  render()
  publishExtras()
}

function applyLevels() {
  if (!engine) return
  for (const { id } of SOUNDS) engine.setLevel(id, mix.sounds[id].on ? mix.sounds[id].volume : 0)
  engine.setMaster(mix.master)
}

async function startSound() {
  if (!engine) {
    try {
      engine = createEngine()
    } catch (err) {
      showFailure()
      return
    }
  }
  applyLevels()
  const running = await engine.start(mix.sleepEnd)
  // Without a press inside this frame the browser may keep audio suspended.
  blocked = !running && mix.playing
  if (!mix.playing) engine.stop()
  render()
}

function play() {
  const sleepEnd = mix.sleepMinutes ? Date.now() + mix.sleepMinutes * 60_000 : null
  commit({ playing: true, sleepEnd })
}

function pause() {
  commit({ playing: false, sleepEnd: null })
}

// ----------------------------------------------------------- Deska events --

function onPlayPress() {
  if (mix.playing && !blocked) return pause()
  takeSpeaker()
  if (mix.playing) startSound()
  else play()
}

/** "Start sound" and "Play here": make this frame the one that plays, now. */
function startHere() {
  takeSpeaker()
  startSound()
}

// A press is the moment the browser lets audio start, so the desk panel
// pressed becomes the speaker. The Extras popover only changes the mix.
function takeSpeaker() {
  if (compact || isSpeaker) return
  isSpeaker = true
  claimSpeaker()
}

function wireDeskaEvents() {
  // The round button on the Extras row. Deska sends it to every frame of the
  // package (and opens the panel when none is alive); the speaker resumes
  // the audio, the others just record the new state.
  deska.on('extras.control', ({ control } = {}) => {
    if (control === 'play' || control === 'start') play()
    if (control === 'pause' || control === 'stop') pause()
  })

  // Hidden (scrolled away, behind a far-view card, another worktree) does not
  // mean closed: the frame keeps running, so the sound plays on, which is
  // what a noise machine is for. Only the meter, which nobody can see, stops.
  deska.on('visibility', updateMeter)
  reducedMotion.addEventListener('change', updateMeter)
}

/** Mirrors the mix on the Extras row: what plays, play or pause, the timer. */
function publishExtras() {
  const names = playingNames()
  const fields = {
    state: names ? (mix.playing ? names : `${names}, paused`) : 'No sound on',
    control: names ? (mix.playing ? 'pause' : 'play') : null,
    // With `until`, Deska counts the time left itself, even with no frame alive.
    until: mix.playing && mix.sleepEnd ? mix.sleepEnd : null,
  }
  const key = JSON.stringify(fields)
  if (key === lastExtras) return
  lastExtras = key
  bridge(deska.extras.set(fields)).then((result) => {
    if (result.ok) return
    lastExtras = ''
    if (result.code === 'rate_limited') setTimeout(publishExtras, 1000)
    else console.warn('Noise Machine: the Extras row was not updated:', result.code)
  })
}

// ------------------------------------------------------------------- UI --

function playingNames() {
  const on = SOUNDS.filter(({ id }) => mix.sounds[id].on).map(({ name }, i) => (i ? name.toLowerCase() : name))
  return on.join(', ')
}

function buildSounds() {
  const template = $('sound-row')
  for (const { id, name } of SOUNDS) {
    const row = template.content.firstElementChild.cloneNode(true)
    row.dataset.id = id
    const toggle = row.querySelector('.toggle')
    const slider = row.querySelector('.slider')
    row.querySelector('.name').textContent = name
    slider.setAttribute('aria-label', `${name} volume`)
    toggle.addEventListener('click', () => setSound(id, { on: !mix.sounds[id].on }))
    // Moving the slider of a silent sound turns it on: that is what was meant.
    slider.addEventListener('input', () => setSound(id, { on: true, volume: slider.valueAsNumber / 100 }))
    $('sounds').append(row)
  }
  $('master').addEventListener('input', (e) => commit({ master: e.target.valueAsNumber / 100 }))
  for (const button of $('sleep').querySelectorAll('button')) {
    button.addEventListener('click', () => setSleep(Number(button.dataset.minutes)))
  }
  $('play').addEventListener('click', onPlayPress)
  $('retry').addEventListener('click', retry)
}

function setSound(id, changes) {
  commit({ sounds: { ...mix.sounds, [id]: { ...mix.sounds[id], ...changes } } })
}

function setSleep(minutes) {
  const sleepEnd = mix.playing && minutes ? Date.now() + minutes * 60_000 : null
  commit({ sleepMinutes: minutes, sleepEnd })
}

function setSlider(slider, value) {
  const percent = Math.round(value * 100)
  if (document.activeElement !== slider || slider.valueAsNumber !== percent) slider.value = percent
  slider.style.setProperty('--fill', `${percent}%`)
}

function render() {
  for (const row of $('sounds').children) {
    const sound = mix.sounds[row.dataset.id]
    row.classList.toggle('on', sound.on)
    row.querySelector('.toggle').setAttribute('aria-pressed', String(sound.on))
    setSlider(row.querySelector('.slider'), sound.volume)
  }
  setSlider($('master'), mix.master)
  for (const button of $('sleep').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === mix.sleepMinutes))
  }
  const names = playingNames()
  const showPause = mix.playing && !blocked
  $('play').classList.toggle('playing', showPause)
  $('play-label').textContent = showPause ? 'Pause' : 'Play'
  $('play').disabled = !names && !mix.playing
  $('now-title').textContent = names || 'No sound on'
  renderStatus()
  renderNotice()
  updateMeter()
}

function renderStatus() {
  $('now-sub').textContent = statusLine()
}

function statusLine() {
  if (!playingNames() && !mix.playing) return 'Turn on a sound below'
  if (blocked) return 'Not started yet'
  if (!mix.playing) return mix.sleepMinutes ? `Paused, stops ${mix.sleepMinutes} min after Play` : 'Paused'
  if (!mix.sleepEnd) return 'Playing'
  const left = mix.sleepEnd - Date.now()
  if (left <= SLEEP_FADE_SECONDS * 1000) return 'Fading out'
  return `Playing, stops in ${Math.ceil(left / 60_000)} min`
}

function renderNotice() {
  let text = ''
  let action = ''
  if (saveFailed) {
    text = 'Your mix could not be saved.'
  } else if (blocked) {
    text = 'Sound is waiting for a press here.'
    action = 'Start sound'
  } else if (compact) {
    text = speakerAlive || !mix.playing ? 'Sound plays from the panel on your desk.' : 'Open Noise Machine on your desk to hear it.'
  } else if (!isSpeaker && speakerAlive && mix.playing) {
    text = 'Playing from another Noise Machine panel.'
    action = 'Play here'
  }
  $('notice').hidden = !text
  $('notice-text').textContent = text
  $('notice-action').hidden = !action
  $('notice-action').textContent = action
}

// The meter is drawing, not sound: it runs only while someone can see it.
function updateMeter() {
  cancelAnimationFrame(meterFrame)
  meterFrame = 0
  const live = isSpeaker && engine?.running && mix.playing && deska.visible && !reducedMotion.matches
  if (live) {
    let smooth = 0
    let last = 0
    const draw = (t) => {
      if (t - last > 50) {
        last = t
        smooth += (engine.level() - smooth) * 0.25
        $('meter-fill').style.transform = `scaleX(${smooth.toFixed(3)})`
      }
      meterFrame = requestAnimationFrame(draw)
    }
    meterFrame = requestAnimationFrame(draw)
    return
  }
  // Still: a static reading of the mix, or empty while paused.
  $('meter-fill').style.transform = `scaleX(${mix.playing && !blocked ? estimatedLevel().toFixed(3) : 0})`
}

function estimatedLevel() {
  let sum = 0
  for (const { id } of SOUNDS) if (mix.sounds[id].on) sum += mix.sounds[id].volume ** 2
  return Math.min(1, Math.sqrt(sum) * mix.master * 0.85)
}

function showFailure() {
  $('player').hidden = true
  $('failure').hidden = false
}

function retry() {
  $('failure').hidden = true
  $('player').hidden = false
  onPlayPress()
}

// ------------------------------------------------------------------ start --

async function start() {
  await deska.ready()
  // The same page serves the desk and the Extras popover; the popover gets a
  // compact layout and never makes sound itself.
  compact = deska.place === 'extras'
  document.body.classList.toggle('compact', compact)

  const stored = await bridge(deska.storage.get(MIX_KEY))
  if (stored.ok) mix = normalize(stored.value)
  else console.warn('Noise Machine: could not read the saved mix:', stored.code)

  buildSounds()
  $('notice-action').addEventListener('click', startHere)
  wireDeskaEvents()
  render()
  publishExtras()
  $('loading').hidden = true
  $('player').hidden = false
  $('app').removeAttribute('aria-busy')

  await sync()
  setInterval(sync, SYNC_MS)
}

start()
