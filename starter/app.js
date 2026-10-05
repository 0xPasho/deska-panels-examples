// My First Panel: a clock that remembers one time zone.
// Read it top to bottom; docs/build-your-first-panel.md walks through it.

const $ = (id) => document.getElementById(id)

// 1. Wait for Deska. ready() resolves with the init payload: the panel, the
//    theme, the permissions it holds and the person's locale.
const init = await deska.ready()

// 2. Load what this panel saved last time. null means a first run.
let zone = (await deska.storage.get('zone')) ?? Intl.DateTimeFormat().resolvedOptions().timeZone

// 3. Render.
function render() {
  const time = new Intl.DateTimeFormat(init.locale, { timeZone: zone, timeStyle: 'short' }).format(new Date())
  $('time').textContent = time
  // The title shows under the panel's name on the canvas.
  deska.setTitle(`${zone.split('/').pop().replaceAll('_', ' ')} ${time}`)
}

for (const name of Intl.supportedValuesOf('timeZone')) $('zone').add(new Option(name, name))
$('zone').value = zone

// 4. Save when the person changes something.
$('zone').addEventListener('change', async () => {
  zone = $('zone').value
  render()
  try {
    await deska.storage.set('zone', zone)
  } catch (err) {
    console.warn(`Could not save: ${err.code}`)
  }
})

// 5. Tick only while someone can see the panel.
let timer = null
function start() {
  render()
  timer = setInterval(render, 15_000)
}
deska.on('visibility', ({ visible }) => {
  clearInterval(timer)
  if (visible) start()
})
if (deska.visible) start()
else render()
