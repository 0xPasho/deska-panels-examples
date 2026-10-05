// Pieces both pages share: one row of the event log, and the answer to a
// press on the Extras row.

import { run, literal } from './call.js'

// What a press asks for, and the control the row should offer next.
const NEXT_CONTROL = { play: 'pause', pause: 'play', start: 'stop', stop: 'start' }

/**
 * Answers a press the way a timer flips Play to Pause. Every open frame of
 * the package hears the same press, so each must give the same answer: the
 * row then ends up the same whichever frame answers last.
 */
export function answerControl(control, out) {
  const next = NEXT_CONTROL[control] ?? null
  run(out, `await deska.extras.set(${literal({ control: next })})`, () => deska.extras.set({ control: next }))
  return next
}

export function eventItem(name, detail) {
  const item = document.createElement('li')
  const time = document.createElement('time')
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const label = document.createElement('code')
  label.textContent = name
  const text = document.createElement('span')
  text.className = 'detail'
  text.textContent = detail
  item.append(time, label, text)
  return item
}
