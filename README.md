# Deska panel examples

Twenty-two open source community panels for [Deska](https://deska.dev), each
one built to teach a different part of the panel SDK. Read one, copy it, or
start your own from the [tutorial](docs/build-your-first-panel.md).

A community panel is a folder of web files with a `panel.json` at its root.
Deska runs it in a sandboxed frame on the person's computer, styles it with
the app's own theme, and lets it reach the app only through `window.deska`.
No build step, no server, no framework.

![Five of these panels in Deska's Extras popover, each with its own state line and control](docs/screenshots/deska/ship-countdown-extras-row.png)

## The panels

| | Panel | What it teaches | Permissions | Sites |
| --- | --- | --- | --- | --- |
| <img src="panels/team-clocks/icon.svg" width="24" alt=""> | [Team Clocks](panels/team-clocks) | **Start here.** `deska.ready()`, theme tokens, `storage`, `setTitle`, pausing on `visibility` | none | none |
| <img src="panels/sdk-playground/icon.svg" width="24" alt=""> | [SDK Playground](panels/sdk-playground) | Every bridge call and every error code, with the line of code each one ran | all three | none |
| <img src="panels/theme-inspector/icon.svg" width="24" alt=""> | [Theme Inspector](panels/theme-inspector) | `deska.on('theme')`, every token live, contrast checks for both modes | clipboard | none |
| <img src="panels/service-status/icon.svg" width="24" alt=""> | [Service Status](panels/service-status) | Fetching from several declared hosts, polling that respects visibility, notify only on a change, an Extras summary | notify, links | 7 status pages |
| <img src="panels/hn-front-page/icon.svg" width="24" alt=""> | [HN Front Page](panels/hn-front-page) | Network errors done right (timeouts, partial results, offline), `openUrl` and its consent model | links | 1 |
| <img src="panels/repo-pulse/icon.svg" width="24" alt=""> | [Repo Pulse](panels/repo-pulse) | Living inside a strict public rate limit: ETags, backoff that survives reloads, images from a second host | notify, links | 2 |
| <img src="panels/weather-now/icon.svg" width="24" alt=""> | [Weather Now](panels/weather-now) | `init.locale` and units, forms under `form-action 'none'`, debounced search, an offline cache | links | 2 |
| <img src="panels/on-this-day/icon.svg" width="24" alt=""> | [On This Day](panels/on-this-day) | Translating a panel, choosing a host per language, lazy images from a declared host, attribution | links | 8 |
| <img src="panels/prompt-shelf/icon.svg" width="24" alt=""> | [Prompt Shelf](panels/prompt-shelf) | `clipboard.write` and its focus rule, a growing collection in storage, keyboard handling in a sandbox | clipboard | none |
| <img src="panels/habit-streaks/icon.svg" width="24" alt=""> | [Habit Streaks](panels/habit-streaks) | Storage as a small database: a versioned document, migrations, compaction, `storage_full`, sharing between copies | none | none |
| <img src="panels/ship-countdown/icon.svg" width="24" alt=""> | [Ship Countdown](panels/ship-countdown) | The Extras row in depth: a view page, `until` that Deska keeps counting, the progress ring, controls | notify | none |
| <img src="panels/net-radio/icon.svg" width="24" alt=""> | [Net Radio](panels/net-radio) | Streaming audio from declared hosts, play and pause from Extras, a compact layout for `place: 'extras'` | links | 7 |
| <img src="panels/noise-machine/icon.svg" width="24" alt=""> | [Noise Machine](panels/noise-machine) | Web Audio with no network and no files, one player across many frames, stopping drawing while hidden | none | none |
| <img src="panels/window-view/icon.svg" width="24" alt=""> | [Window View](panels/window-view) | Video from a declared host, pausing on visibility and idle to save power, crediting licensed media | links | 1 |
| <img src="panels/daily-standup/icon.svg" width="24" alt=""> | [Daily Standup](panels/daily-standup) | Saving as the person types, flushed on hide; Markdown to the clipboard from a click or Cmd+Enter; dated notes compacted in storage | clipboard | none |
| <img src="panels/regex-tester/icon.svg" width="24" alt=""> | [Regex Tester](panels/regex-tester) | Heavy work with no workers: timing each run and falling back to a Run button; building text with DOM nodes, never `innerHTML` | none | none |
| <img src="panels/json-tools/icon.svg" width="24" alt=""> | [JSON Formatter](panels/json-tools) | Errors that point at a line and column; editing a textarea so Undo survives; not saving what is too big, and saying so | clipboard | none |
| <img src="panels/contrast-checker/icon.svg" width="24" alt=""> | [Contrast Checker](panels/contrast-checker) | Showing the person's colors while the panel stays on theme tokens; Pass and Fail in words, not color alone | none | none |
| <img src="panels/cron-explainer/icon.svg" width="24" alt=""> | [Cron Explainer](panels/cron-explainer) | A live `setTitle` refreshed on the minute while visible; validation that says what to change | none | none |
| <img src="panels/unix-time/icon.svg" width="24" alt=""> | [Unix Time](panels/unix-time) | A clock ticking only while seen; one copy button per value; telling the person how their input was read | clipboard | none |
| <img src="panels/breathing-timer/icon.svg" width="24" alt=""> | [Breathing Timer](panels/breathing-timer) | One page for the desk and Extras, a session kept as timestamps so every frame agrees, `prefers-reduced-motion` | none | none |
| <img src="panels/sample-data/icon.svg" width="24" alt=""> | [Sample Data](panels/sample-data) | Seeded output that survives a reload; measuring against the 64 KB clipboard limit before Deska refuses | clipboard | none |

Each panel's own README walks through its code, explains every permission and
host it asks for, and lists what it could not do.

### In Deska

These screenshots come from Deska itself: each panel installed through
Discover, the way people get them.

| | |
| --- | --- |
| ![Team Clocks](docs/screenshots/deska/team-clocks-light.png) | ![Service Status](docs/screenshots/deska/service-status-dark.png) |
| ![Weather Now](docs/screenshots/deska/weather-now-dark.png) | ![HN Front Page](docs/screenshots/deska/hn-front-page-light.png) |
| ![Window View](docs/screenshots/deska/window-view-dark.png) | ![On This Day](docs/screenshots/deska/on-this-day-light.png) |
| ![Repo Pulse](docs/screenshots/deska/repo-pulse-dark.png) | ![Prompt Shelf](docs/screenshots/deska/prompt-shelf-light.png) |
| ![Habit Streaks](docs/screenshots/deska/habit-streaks-dark.png) | ![Ship Countdown](docs/screenshots/deska/ship-countdown-light.png) |
| ![Net Radio](docs/screenshots/deska/net-radio-dark.png) | ![Noise Machine](docs/screenshots/deska/noise-machine-light.png) |
| ![Theme Inspector](docs/screenshots/deska/theme-inspector-dark.png) | ![SDK Playground](docs/screenshots/deska/sdk-playground-light.png) |

The newest eight, in the preview host (`tools/preview/`) with Deska's dark
and light themes:

| | |
| --- | --- |
| ![Daily Standup](docs/screenshots/preview/daily-standup-dark.png) | ![Regex Tester](docs/screenshots/preview/regex-tester-light.png) |
| ![JSON Formatter](docs/screenshots/preview/json-tools-dark.png) | ![Contrast Checker](docs/screenshots/preview/contrast-checker-light.png) |
| ![Cron Explainer](docs/screenshots/preview/cron-explainer-dark.png) | ![Unix Time](docs/screenshots/preview/unix-time-light.png) |
| ![Breathing Timer](docs/screenshots/preview/breathing-timer-dark.png) | ![Sample Data](docs/screenshots/preview/sample-data-light.png) |

## Use a panel

**From Discover.** In Deska, open the Panel Library (Cmd+Shift+E on macOS,
Ctrl+Shift+E elsewhere), go to *Community*, then *Discover*, and search for
the panel's name. *Install and add* shows what it may do before anything is
copied.

**From this repo.** Clone it, then in the Panel Library open *Build a panel*,
choose *Load a folder* and pick a folder under `panels/`. Deska checks it and
puts it on your desk.

```sh
git clone https://github.com/0xPasho/deska-panels-examples.git
```

## Build your own

1. Read [Build your first panel](docs/build-your-first-panel.md). It takes
   about fifteen minutes and ends with a panel loaded in Deska.
2. Copy [`starter/`](starter) or the example closest to your idea, and change
   `id`, `name` and `author` in `panel.json`.
3. Preview it next to your editor, then load the folder in Deska.

Every bridge method, with its arguments, permission, errors and limits, is in
the [SDK reference](https://deska.dev/docs/panel-sdk); every `panel.json`
field is in the [panel.json reference](https://deska.dev/docs/panel-manifest).

## Documentation

The maintained guide lives on deska.dev, in English and Spanish:

- [Build panels](https://deska.dev/docs/build-panels): what a panel is and
  where everything is documented.
- [Build your first panel](https://deska.dev/docs/tutorial-first-panel): the
  tutorial, step by step.
- [SDK reference](https://deska.dev/docs/panel-sdk): every method of
  `window.deska`, the init payload, the properties and the events.
- [panel.json reference](https://deska.dev/docs/panel-manifest): every field,
  the ids that are refused, and the package limits.
- [The sandbox](https://deska.dev/docs/panel-sandbox): what a panel cannot do,
  rule by rule, and what to do instead.
- [Publishing](https://deska.dev/docs/panel-publishing): applying to publish,
  versions, permissions asked again, and limits.
- [The panel marketplace](https://deska.dev/panels): every panel you can
  install, these examples included.

## Tools in this repo

```sh
npm install                              # Playwright, for the checks
npm run preview -- panels/team-clocks    # one panel, or several, or none for all
npm run validate                         # Deska's package checks, no browser
npm run check                            # checks plus a headless load in dark and light
```

- **Preview** (`tools/preview/`) serves a panel with the same
  Content-Security-Policy and sandbox Deska uses, and plays Deska's side of the
  bridge: theme, visibility, storage, notify, links, clipboard and the Extras
  row, with a log of every call. It enforces Deska's limits, so a call Deska
  would refuse is refused here too.
- **Check** (`tools/check.mjs`) fails on a console error, a policy violation,
  a page that never calls `deska.ready()`, or a refused call, and writes
  screenshots to `docs/screenshots/preview/`.

The preview is a stand-in to build fast. Before you publish, load the folder in
Deska: that is the runtime your panel ships to.

## What a panel can and cannot do

What these examples work around, so you do not have to find out the hard way:

- **No frames, embeds, workers or remote scripts.** A YouTube or Spotify
  embed cannot run in a panel. Media plays from hosts you declare, with
  `<audio>` and `<video>` (see Net Radio and Window View).
- **Only the hosts in `network`, over https, with open CORS.** The panel's
  origin is opaque, so an API must answer `Access-Control-Allow-Origin: *`.
- **`deska.storage` is the only storage that lasts.** `localStorage`,
  `indexedDB` and cookies are not available in the sandbox. 256 KB per package,
  shared by every copy of the panel on the computer.
- **No secrets.** There is nowhere safe to keep a token, so every example uses
  public APIs that need no key.
- **Forms never navigate, and there are no popups or `alert()`.** Handle submit
  yourself; open links with `deska.openUrl`.
- **Every call can fail with a code.** `permission_denied`, `not_focused`,
  `rate_limited`, `storage_full`, `invalid_args` and the rest: the SDK
  Playground shows each one.

## Data and attribution

The panels use public services under their own terms:
[Atlassian Statuspage](https://www.atlassian.com/software/statuspage) pages of
each listed company, the [Hacker News API](https://github.com/HackerNews/API),
the [GitHub REST API](https://docs.github.com/rest),
[Open-Meteo](https://open-meteo.com) (CC BY 4.0),
[Wikipedia](https://www.wikipedia.org) (CC BY-SA 4.0),
[Wikimedia Commons](https://commons.wikimedia.org) media under the license
credited on each scene, and [SomaFM](https://somafm.com), a listener supported
radio station: please [support them](https://somafm.com/support/) if you listen.
None of these services is affiliated with Deska or with these examples.

## Contributing

Fixes and new examples are welcome. A new example should teach something the
others do not, pass `npm run check`, use only Deska's theme tokens for color,
and look right in both themes. Open an issue first if you are not sure it fits.

## License

[MIT](LICENSE). The data each panel shows belongs to its source; see above.
