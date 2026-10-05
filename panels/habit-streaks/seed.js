// FIRST-RUN SEED. Demo data, written once when this package has never stored
// anything, so a new panel shows what it does instead of an empty list. Delete
// this file and the one call to it in app.js to start new panels empty.

import { VERSION, dayNumber, keyFromNumber, setDone } from './habits.js'

const HISTORY_DAYS = 70

// name, how often it was done, days in the current run, done today
const HABITS = [
  ['Review PRs', 0.8, 9, true],
  ['Write tests first', 0.55, 3, false],
  ['Walk', 0.7, 5, true],
]

// A small seeded random so every first run looks the same.
function random(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function seedDoc(today) {
  const doc = { version: VERSION, since: null, habits: [], days: {} }
  const end = dayNumber(today)
  const next = random(7)
  HABITS.forEach(([name, rate, run, doneToday], i) => {
    const id = `h${i + 1}`
    doc.habits.push({ id, name, archived: false, before: { run: 0, best: 0 } })
    const runEnd = doneToday ? end : end - 1
    for (let n = end - HISTORY_DAYS; n <= end; n++) {
      const inRun = n > runEnd - run && n <= runEnd
      const done = inRun || (n < runEnd - run && next() < rate)
      if (done && !(n === end && !doneToday)) setDone(doc, id, keyFromNumber(n), true)
    }
  })
  return doc
}
