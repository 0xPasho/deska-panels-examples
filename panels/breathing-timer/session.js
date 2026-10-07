// Breathing patterns and a session that lives in storage as timestamps, so
// every frame of this package (the desk panel and the Extras view) derives
// the same moment from the clock. No DOM here.

export const PATTERNS = [
  { id: 'box', name: 'Box breathing (4-4-4-4)', short: 'Box breathing', phases: [['in', 4], ['hold', 4], ['out', 4], ['rest', 4]] },
  { id: '478', name: 'Relaxing (4-7-8)', short: '4-7-8 breathing', phases: [['in', 4], ['hold', 7], ['out', 8]] },
  { id: 'coherent', name: 'Slow (5.5 in, 5.5 out)', short: 'Slow breathing', phases: [['in', 5.5], ['out', 5.5]] },
  { id: 'calm', name: 'Longer out (4 in, 6 out)', short: 'Longer out', phases: [['in', 4], ['out', 6]] },
]

export const WORDS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out', rest: 'Hold' }

export const patternById = (id) => PATTERNS.find((p) => p.id === id) || PATTERNS[0]

/** A session: { pattern, minutes, startedAt, pausedAt, pausedMs, doneAt,
 *  chimed }. Idle when startedAt is null; doneAt marks the last finish. */
export function idle(pattern = 'box', minutes = 3) {
  return { pattern, minutes, startedAt: null, pausedAt: null, pausedMs: 0, doneAt: null, chimed: null }
}

export function read(saved) {
  if (!saved || typeof saved !== 'object') return idle()
  const s = idle(PATTERNS.some((p) => p.id === saved.pattern) ? saved.pattern : 'box', [1, 3, 5, 10].includes(saved.minutes) ? saved.minutes : 3)
  if (typeof saved.startedAt === 'number') {
    s.startedAt = saved.startedAt
    s.pausedAt = typeof saved.pausedAt === 'number' ? saved.pausedAt : null
    s.pausedMs = typeof saved.pausedMs === 'number' ? saved.pausedMs : 0
  }
  if (typeof saved.doneAt === 'number') s.doneAt = saved.doneAt
  if (typeof saved.chimed === 'number') s.chimed = saved.chimed
  return s
}

export const running = (s) => s.startedAt !== null && s.pausedAt === null
export const paused = (s) => s.startedAt !== null && s.pausedAt !== null

/** Milliseconds of breathing done so far. */
export function elapsed(s, now) {
  if (s.startedAt === null) return 0
  return (s.pausedAt ?? now) - s.startedAt - s.pausedMs
}

export const total = (s) => s.minutes * 60_000

/** Where the breath is: { phase, word, progress (0 to 1 within the phase),
 *  secondsLeft (in the phase), scale (0 small to 1 full lungs) }. */
export function breath(s, now) {
  const pattern = patternById(s.pattern)
  const cycle = pattern.phases.reduce((sum, [, sec]) => sum + sec, 0) * 1000
  let t = elapsed(s, now) % cycle
  let fullness = 0
  for (const [phase, sec] of pattern.phases) {
    const len = sec * 1000
    if (t < len) {
      const progress = t / len
      // Lungs fill on "in", stay full on "hold", empty on "out", stay empty on "rest".
      const scale = phase === 'in' ? ease(progress) : phase === 'out' ? 1 - ease(progress) : phase === 'hold' ? 1 : 0
      return { phase, word: WORDS[phase], progress, secondsLeft: Math.ceil((len - t) / 1000), scale }
    }
    t -= len
    fullness = phase === 'in' ? 1 : phase === 'out' ? 0 : fullness
  }
  return { phase: 'rest', word: WORDS.rest, progress: 0, secondsLeft: 0, scale: fullness }
}

// A soft in-and-out curve reads like a breath; a straight line feels mechanical.
const ease = (x) => 0.5 - Math.cos(Math.PI * x) / 2

export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
