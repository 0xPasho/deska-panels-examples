# Build your first panel

> The maintained version of this tutorial is on deska.dev:
> [Build your first panel](https://deska.dev/docs/tutorial-first-panel), with
> the [SDK reference](https://deska.dev/docs/panel-sdk) and the rest of the
> [Build panels](https://deska.dev/docs/build-panels) guide. This copy follows
> the same steps for reading next to the code.

In about fifteen minutes you build a small clock panel, run it next to your
editor, load it in Deska and get it ready to publish. The finished result is
the [`starter/`](../starter) folder in this repo; copy it if you would rather
start from there.

You need Deska 1.26.0 or later and Node 20 or later for the preview tool.
There is no build step and nothing to host: a panel is a folder of web files.

## 1. Make the folder and its panel.json

```
my-first-panel/
  panel.json
  index.html
  app.css
  app.js
  icon.svg
```

`panel.json` tells Deska what the panel is and what it may do:

```json
{
  "schema": 1,
  "id": "my-first-panel",
  "name": "My First Panel",
  "version": "0.1.0",
  "description": "A small clock that remembers one time zone.",
  "author": "Your name",
  "icon": "icon.svg",
  "category": "other",
  "permissions": [],
  "network": [],
  "sdk": 1,
  "contributes": {
    "panel": { "entry": "index.html", "scope": "workspace", "size": { "width": 300, "height": 200 } }
  }
}
```

- `id` is 3 to 40 lowercase letters, digits and dashes. Publishing claims it
  for your account. Ids that name Deska, a coding agent or a built-in panel are
  refused (`spotify`, `youtube`, `pomodoro`, `todo` and so on).
- `permissions` and `network` are empty: this panel cannot notify, open links,
  copy, or reach the internet. Ask only for what you use; people see the list
  before they install.
- Every field is described in the
  [panel.json reference](https://deska.dev/docs/panel-manifest).

## 2. Load the SDK in index.html

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My First Panel</title>
  <link rel="stylesheet" href="app.css">
  <script src="/__deska/sdk.js"></script>
  <script type="module" src="app.js"></script>
</head>
<body>
  <main>
    <p class="time" id="time">--:--</p>
    <label class="field">
      <span>Time zone</span>
      <select id="zone"></select>
    </label>
  </main>
</body>
</html>
```

`/__deska/sdk.js` is not a file in your folder. Deska serves it inside every
panel, always matching the app you run, and it defines `window.deska`. Load it
as a classic script before anything that uses it.

## 3. Style with Deska's tokens

The SDK writes Deska's theme on `<html>` as CSS custom properties and keeps
them current when the person switches theme or accent. Use them for every
color and the panel looks native in dark, light and every accent:

```css
body {
  margin: 0;
  background: var(--deska-bg);
  color: var(--deska-text);
  font: 13px/1.45 var(--deska-font-ui);
}

select {
  color: var(--deska-text);
  background: var(--deska-surface);
  border: 1px solid var(--deska-border);
  border-radius: var(--deska-radius-small);
}

select:focus-visible {
  outline: 2px solid var(--deska-focus);
}
```

The full list: `--deska-bg`, `--deska-surface`, `--deska-surface-raised`,
`--deska-text`, `--deska-text-secondary`, `--deska-text-tertiary`,
`--deska-accent`, `--deska-on-accent`, `--deska-border`, `--deska-focus`,
`--deska-danger`, `--deska-success`, `--deska-font-ui`, `--deska-font-mono`,
`--deska-radius`, `--deska-radius-small`. The
[Theme Inspector](../panels/theme-inspector) panel shows each one live, with
its contrast.

## 4. Write app.js in five steps

```js
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
  deska.setTitle(`${zone.split('/').pop().replaceAll('_', ' ')} ${time}`)
}

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
deska.on('visibility', ({ visible }) => { /* start or stop the timer */ })
```

What each step teaches:

1. **`deska.ready()`.** Nothing from the bridge works before it. Outside Deska
   it never resolves, so a page opened by itself simply waits.
2. **`deska.storage`.** The only storage that lasts. The panel runs in a
   sandbox with an opaque origin, so `localStorage`, `indexedDB` and cookies
   are not available. Values are JSON, up to 256 KB per package, shared by
   every copy of the panel on this computer.
3. **`deska.setTitle`.** A short line under the panel's name on the canvas:
   a non-empty string of up to 60 characters. Longer is refused, not cut, and
   there is no empty title: set `init.panel.name` to show the name alone.
4. **Errors have codes.** Every call returns a promise; a failure is an
   `Error` whose `code` says why (`storage_full`, `rate_limited`,
   `permission_denied`, `not_focused`...). Answer the ones a person can act on.
5. **`deska.on('visibility')`.** A panel scrolled away, folded into a dock or
   behind the far view keeps running. Stop timers and animations while it is
   hidden and catch up when it shows again.

A panel can reload at any time (moved to a dock, updated, Deska restarted), so
keep what matters in storage and rebuild from `init`.

## 5. Preview it

From this repo:

```sh
npm install
npm run preview -- path/to/my-first-panel
```

Open the address it prints. The preview serves your folder with the same
Content-Security-Policy and sandbox as Deska, plays Deska's side of the bridge,
and lets you switch theme, visibility and place (desk or Extras) while the
bridge log shows every call. `npm run check` runs the same checks Deska does
plus a headless load in both themes, and fails on any console error or policy
violation.

The preview is a stand-in. The runtime your panel ships to is Deska itself.

## 6. Load it in Deska

1. Open the Panel Library (Cmd+Shift+E on macOS, Ctrl+Shift+E elsewhere).
2. Under *Community*, open *Build a panel* and choose *Load a folder*.
3. Pick the folder that holds `panel.json`.

Deska checks the folder, lists anything to fix, and adds the panel to your
desk. It reloads the panel every time you save a file. Switch Deska's theme to
check both looks, and open the panel in a dock to see it reload and come back
with what it saved.

## 7. Publish

Publishing is open to invited authors for now. Apply at
[deska.dev/panels/apply](https://deska.dev/panels/apply) (*Ask to publish* in
*Build a panel* leads there too), or write to help@deska.dev about what you are
building.

Once your account can publish, open the loaded folder's page in *Build a
panel*, press *Publish*, write what changed and confirm. A published version
never changes: raise `version` in `panel.json` for every release. The rest is
in [Publishing](https://deska.dev/docs/panel-publishing).

## Rules that save you a debugging session

- **No iframes, embeds, workers or remote scripts.** The policy is
  `frame-src 'none'`, `worker-src 'none'`, and scripts only from your package.
  A YouTube or Spotify embed cannot work in a panel.
- **Only the hosts in `network`, over https.** The API must answer CORS with
  `Access-Control-Allow-Origin: *`, because the panel's origin is opaque.
  Images, audio and video load from those hosts too.
- **Forms never navigate.** `form-action 'none'`: call `preventDefault()` in
  your submit handler.
- **No `alert`, `confirm`, `prompt` or popups.** Links go through
  `deska.openUrl(url)` (the `open-url` permission), called from a click.
- **Focus moves only when the person acts.** Calling `focus()` from a timer
  does nothing. Use `deska.notify` to get attention.
- **No secrets.** There is no safe place for a token in a panel. Use public
  APIs, or APIs the person signs in to in their own browser.

## Where to go next

Each panel in [`panels/`](../panels) teaches one part of the SDK; the
[README](../README.md) maps them. Good second reads:

- [SDK Playground](../panels/sdk-playground): every call and every error code.
- [Service Status](../panels/service-status): network, notify on change,
  polling that respects visibility.
- [Ship Countdown](../panels/ship-countdown): the Extras row, with a countdown
  Deska keeps running.
