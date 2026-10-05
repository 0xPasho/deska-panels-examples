// The compact view Extras opens in its popover (contributes.extras.view).
// It is a second page of the same package: same origin, same deska.storage,
// same countdowns.js. It does the work the panel does (notify, keep the
// Extras row current), so Extras stays right even when only this view is open.

import {
  sorted,
  isDone,
  elapsed,
  left,
  shippedAgo,
  shortLeft,
  formatTarget,
  syncExtras,
  notifyFinished,
  dismissFinished,
  describeError,
} from './countdowns.js'

const $ = (id) => document.getElementById(id)
const pad = (n) => String(n).padStart(2, '0')
let locale = 'en-US'
let timer = null

function unit(value, label) {
  const span = document.createElement('span')
  span.className = 'unit'
  const b = document.createElement('b')
  b.textContent = value
  const small = document.createElement('small')
  small.textContent = label
  span.append(b, small)
  return span
}

function render(list, now) {
  $('status').hidden = true
  $('error').hidden = true
  const all = sorted(list, now)
  // A finished countdown nobody dismissed leads, like in the Extras row.
  const finished = all.filter((c) => isDone(c, now) && !c.dismissed)[0]
  const lead = finished || all.find((c) => !isDone(c, now))
  $('empty').hidden = !!lead
  $('hero').hidden = !lead
  if (!lead) {
    $('later').hidden = true
    return
  }

  const done = isDone(lead, now)
  const share = elapsed(lead, now)
  $('hero').classList.toggle('done', done)
  $('arc').style.strokeDasharray = `${share * 100} 100`
  $('hero-name').textContent = lead.name
  $('hero-meta').textContent = formatTarget(lead, locale)
  $('dismiss').hidden = !done
  $('dismiss').setAttribute('aria-label', `Dismiss ${lead.name}`)
  if (done) {
    $('hero-clock').replaceChildren(shippedAgo(lead, now))
    $('hero-note').textContent = ''
  } else {
    const { days, hours, minutes } = left(lead, now)
    $('hero-clock').replaceChildren(unit(days, days === 1 ? 'day' : 'days'), unit(pad(hours), 'h'), unit(pad(minutes), 'min'))
    $('hero-clock').setAttribute('aria-label', `${days} days, ${hours} hours, ${minutes} minutes left`)
    $('hero-note').textContent = `${Math.floor(share * 100)}% of the run-up elapsed`
  }

  const rest = all.filter((c) => c !== lead && !isDone(c, now)).slice(0, 4)
  $('later').hidden = rest.length === 0
  $('later').replaceChildren(
    ...rest.map((c) => {
      const li = document.createElement('li')
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = c.name
      const time = document.createElement('span')
      time.className = 'left'
      time.textContent = shortLeft(c, now)
      li.append(label, time)
      return li
    }),
  )
}

function showError(err) {
  for (const id of ['status', 'empty', 'hero', 'later']) $(id).hidden = true
  $('error-text').textContent = describeError(err)
  $('error').hidden = false
}

// Re-reading storage on every tick is how this page sees what the panel changed.
async function tick() {
  clearTimeout(timer)
  const now = Date.now()
  try {
    const list = await notifyFinished(now)
    render(list, now)
    await syncExtras(list, now)
  } catch (err) {
    showError(err)
    return
  }
  timer = setTimeout(tick, deska.visible && !deska.idle ? 1000 - (Date.now() % 1000) + 5 : 15_000)
}

async function dismiss() {
  try {
    await dismissFinished(Date.now())
  } catch (err) {
    showError(err)
    return
  }
  tick()
}

$('dismiss').addEventListener('click', dismiss)
$('retry').addEventListener('click', tick)

const init = await deska.ready()
locale = init.locale || locale

deska.on('visibility', tick)
// The row's stop control can be pressed while this view is open, too.
deska.on('extras.control', ({ control }) => {
  if (control === 'stop') dismiss()
})

tick()
