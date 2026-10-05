// The Extras view: the page Deska shows when someone opens this package's
// row in Extras. It runs the same SDK as the panel, with deska.place set to
// 'extras', and hears the same extras.control presses.

import { literal } from './call.js'
import { answerControl, eventItem } from './events.js'

const $ = (id) => document.getElementById(id)

boot()

async function boot() {
  await deska.ready()
  $('waiting').hidden = true
  $('content').hidden = false
  $('app').removeAttribute('aria-busy')
  renderLive()

  deska.on('visibility', renderLive)
  deska.on('extras.control', ({ control }) => {
    $('out').hidden = false
    const next = answerControl(control, $('out'))
    $('events').prepend(eventItem(control, `answered with control ${literal(next)}`))
    $('events-empty').hidden = true
    $('events').hidden = false
  })
}

function renderLive() {
  $('live-place').textContent = literal(deska.place)
  $('live-visible').textContent = literal(deska.visible)
}
