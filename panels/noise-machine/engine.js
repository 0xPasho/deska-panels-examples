// The sound engine: every sound is generated here with the Web Audio API.
// Nothing is downloaded, so the panel needs no `network` hosts and works
// offline. Each noise color is computed once into a looping buffer; rain and
// the fan are those buffers shaped by filters, a hum and slow random drift.

export const SOUNDS = [
  { id: 'white', name: 'White noise' },
  { id: 'pink', name: 'Pink noise' },
  { id: 'brown', name: 'Brown noise' },
  { id: 'rain', name: 'Rain' },
  { id: 'fan', name: 'Fan' },
]

const LOOP_SECONDS = 8
const SEAM_SECONDS = 0.5 // crossfaded so the loop point never clicks
const TARGET_RMS = 0.18 // every color starts equally loud
const START_SECONDS = 0.8
const STOP_SECONDS = 0.3
export const SLEEP_FADE_SECONDS = 60

// Per sound loudness trim, so equal sliders sound roughly equal.
const TRIM = { white: 0.55, pink: 0.85, brown: 1.15, rain: 1, fan: 1.2 }

function noiseSource(kind) {
  const white = () => Math.random() * 2 - 1
  if (kind === 'white') return white
  if (kind === 'brown') {
    let last = 0
    return () => {
      last = (last + 0.02 * white()) / 1.02
      return last * 3.5
    }
  }
  // Pink: Paul Kellet's filter, a sum of leaky integrators over white noise.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  return () => {
    const w = white()
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    return out
  }
}

function fillLoop(kind, data, sampleRate) {
  const seam = Math.floor(SEAM_SECONDS * sampleRate)
  const next = noiseSource(kind)
  const raw = new Float32Array(data.length + seam)
  for (let i = 0; i < raw.length; i++) raw[i] = next()
  // Blend the extra tail into the head: the last sample flows into the first.
  for (let i = 0; i < data.length; i++) {
    const t = i < seam ? i / seam : 1
    data[i] = i < seam ? raw[i] * t + raw[data.length + i] * (1 - t) : raw[i]
  }
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  const scale = TARGET_RMS / Math.sqrt(sum / data.length || 1)
  for (let i = 0; i < data.length; i++) data[i] *= scale
}

function makeLoop(ctx, kind) {
  const buffer = ctx.createBuffer(2, Math.floor(LOOP_SECONDS * ctx.sampleRate), ctx.sampleRate)
  // A different stream per ear gives the sound width.
  for (let c = 0; c < 2; c++) fillLoop(kind, buffer.getChannelData(c), ctx.sampleRate)
  return buffer
}

function play(ctx, buffer, into, offset = 0) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.connect(into)
  src.start(0, offset)
  return src
}

function filter(ctx, type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = Q
  return f
}

function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
  return nodes[0]
}

const random = (min, max) => min + Math.random() * (max - min)

/** Builds the whole graph. Throws `no_web_audio` when the browser has none. */
export function createEngine() {
  const Context = window.AudioContext || window.webkitAudioContext
  if (!Context) throw new Error('no_web_audio')
  // Created inside a press, so the context may start running; when not, it
  // waits suspended until resume() is allowed.
  const ctx = new Context({ latencyHint: 'playback' })
  const loops = { white: makeLoop(ctx, 'white'), pink: makeLoop(ctx, 'pink'), brown: makeLoop(ctx, 'brown') }

  const master = ctx.createGain()
  const fade = ctx.createGain() // start, stop and the sleep timer's fade
  fade.gain.value = 0
  const limiter = ctx.createDynamicsCompressor() // keeps a full mix from clipping
  limiter.threshold.value = -8
  limiter.ratio.value = 12
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  chain(master, fade, limiter, analyser, ctx.destination)

  const voices = {}
  for (const { id } of SOUNDS) {
    voices[id] = ctx.createGain()
    voices[id].gain.value = 0
    voices[id].connect(master)
  }

  play(ctx, loops.white, chain(filter(ctx, 'lowpass', 9000), voices.white))
  play(ctx, loops.pink, voices.pink)
  play(ctx, loops.brown, voices.brown)

  // Rain: a pink wash with the lows cut, plus a brighter patter layer.
  const wash = ctx.createGain()
  const washTone = filter(ctx, 'lowpass', 6500)
  play(ctx, loops.pink, chain(filter(ctx, 'highpass', 400), washTone, wash, voices.rain), 3.1)
  const patter = ctx.createGain()
  patter.gain.value = 0.25
  play(ctx, loops.white, chain(filter(ctx, 'bandpass', 2600, 0.8), patter, voices.rain), 5.3)

  // Fan: brown noise with the highs gone, a faint motor hum and slow wobble.
  const body = ctx.createGain()
  play(ctx, loops.brown, chain(filter(ctx, 'lowpass', 380), body, voices.fan), 2.7)
  for (const [hz, level] of [[100, 0.014], [200, 0.005]]) {
    const hum = ctx.createOscillator()
    hum.frequency.value = hz
    const g = ctx.createGain()
    g.gain.value = level
    chain(hum, g, voices.fan)
    hum.start()
  }
  const wobble = ctx.createOscillator()
  wobble.frequency.value = 0.23
  const depth = ctx.createGain()
  depth.gain.value = 0.05
  chain(wobble, depth, body.gain)
  wobble.start()

  // Gentle random drift keeps rain from sounding like a recording on loop.
  function drift() {
    if (ctx.state === 'running') {
      const t = ctx.currentTime
      wash.gain.setTargetAtTime(random(0.65, 1), t, 0.6)
      patter.gain.setTargetAtTime(random(0.12, 0.4), t, 0.25)
      washTone.frequency.setTargetAtTime(random(5000, 7500), t, 1.2)
    }
    setTimeout(drift, random(700, 1900))
  }
  drift()

  let stopTimer = 0
  const samples = new Float32Array(analyser.fftSize)

  return {
    get running() {
      return ctx.state === 'running'
    },

    setLevel(id, value) {
      voices[id].gain.setTargetAtTime(value * value * TRIM[id], ctx.currentTime, 0.05)
    },

    setMaster(value) {
      master.gain.setTargetAtTime(value * value, ctx.currentTime, 0.05)
    },

    /** Resumes and fades in. Resolves false when the browser keeps sound blocked. */
    async start(sleepEnd) {
      clearTimeout(stopTimer)
      // resume() can stay pending without a press, so give it a short window.
      await Promise.race([ctx.resume().catch(() => {}), new Promise((ok) => setTimeout(ok, 400))])
      if (ctx.state !== 'running') return false
      this.shapeFade(sleepEnd)
      return true
    },

    /** Fades out, then suspends so a paused panel costs nothing. */
    stop() {
      const g = fade.gain
      const now = ctx.currentTime
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + STOP_SECONDS)
      clearTimeout(stopTimer)
      stopTimer = setTimeout(() => ctx.suspend().catch(() => {}), STOP_SECONDS * 1000 + 50)
    },

    /** Fades in, and when a sleep timer is set, schedules its fade out on the audio clock. */
    shapeFade(sleepEnd) {
      if (ctx.state !== 'running') return
      const g = fade.gain
      const now = ctx.currentTime
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(1, now + START_SECONDS)
      if (!sleepEnd) return
      // The audio clock keeps time even when the page's timers are throttled.
      const left = (sleepEnd - Date.now()) / 1000
      const length = Math.min(SLEEP_FADE_SECONDS, Math.max(left - START_SECONDS, 0.1))
      const from = now + Math.max(left - length, START_SECONDS)
      g.setValueAtTime(1, from)
      g.linearRampToValueAtTime(0, from + length)
    },

    /** The output level from 0 to 1, on a 60 dB scale. */
    level() {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6)
      return Math.min(1, Math.max(0, (db + 60) / 60))
    },
  }
}
