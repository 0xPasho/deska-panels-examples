// Deska's side of the panel bridge, for previewing outside Deska
// (contract §4). Limits follow Deska's; when they disagree, Deska wins.
;(async function () {
  'use strict'

  const STORAGE_MAX = 256 * 1024
  const CLIPBOARD_MAX = 64 * 1024
  const NOTIFY_EVERY_MS = 10_000
  const TITLE_MAX = 60
  const STATE_MAX = 60
  const CONTROLS = ['play', 'pause', 'start', 'stop']
  const NOTIFY_TITLE_MAX = 80
  const NOTIFY_BODY_MAX = 240
  const OPEN_URL_MAX = 2048

  // Deska folds whitespace and refuses invisible characters' effect the same way.
  const clean = (raw) => {
    if (typeof raw !== 'string') return null
    const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
    return text || null
  }

  const themes = await (await fetch('/themes.json')).json()
  const panels = await (await fetch('/panels.json')).json()
  const params = new URLSearchParams(location.search)

  const $ = (id) => document.getElementById(id)
  const select = $('panel')
  for (const p of panels) select.add(new Option(p.manifest.name, p.id))
  select.value = params.get('panel') || panels[0].id

  const state = {
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    place: params.get('place') === 'extras' ? 'extras' : 'panel',
    visible: true,
    idle: false,
    frame: null,
    lastNotify: 0,
    calls: [],
    extras: {},
    title: null,
  }

  const current = () => panels.find((p) => p.id === select.value)

  function log(text, kind) {
    const li = document.createElement('li')
    li.textContent = `${new Date().toLocaleTimeString()}  ${text}`
    if (kind) li.className = kind
    $('log').prepend(li)
    while ($('log').children.length > 200) $('log').lastChild.remove()
  }

  // --- storage: one namespace per package, like Deska -----------------------
  const storeKey = () => `deska-preview:${current().id}`
  const readStore = () => JSON.parse(localStorage.getItem(storeKey()) || '{}')
  function writeStore(next) {
    const text = JSON.stringify(next)
    if (new Blob([text]).size > STORAGE_MAX) return false
    localStorage.setItem(storeKey(), text)
    return true
  }

  // --- talking to the frame --------------------------------------------------
  function post(message) {
    state.frame?.contentWindow?.postMessage(message, '*')
  }
  const themePayload = () => ({ mode: state.theme, tokens: themes[state.theme] })
  const visibilityPayload = () => ({ visible: state.visible, idle: state.idle })

  function initPayload() {
    const p = current()
    return {
      panel: { id: p.id, name: p.manifest.name, version: p.manifest.version, dev: true },
      place: state.place,
      theme: themePayload(),
      visibility: visibilityPayload(),
      permissions: p.manifest.permissions,
      locale: navigator.language || 'en-US',
    }
  }

  const frameFocused = () => document.hasFocus() && document.activeElement === state.frame

  function rateLimited() {
    const now = Date.now()
    state.calls = state.calls.filter((t) => now - t < 1000)
    state.calls.push(now)
    return state.calls.length > 40
  }

  const methods = {
    'storage.get': ([key]) => {
      if (typeof key !== 'string' || !key || key.length > 256) throw 'invalid_args'
      const v = readStore()[key]
      return v === undefined ? null : v
    },
    'storage.set': ([key, value]) => {
      if (typeof key !== 'string' || !key || key.length > 256 || value === undefined) throw 'invalid_args'
      const next = { ...readStore(), [key]: JSON.parse(JSON.stringify(value)) }
      if (!writeStore(next)) throw 'storage_full'
      return null
    },
    'storage.remove': ([key]) => {
      const next = readStore()
      delete next[key]
      writeStore(next)
      return null
    },
    'storage.keys': () => Object.keys(readStore()),
    setTitle: ([title]) => {
      // Like Deska: a non-empty string up to 60 characters. There is no way to
      // clear a title; set the panel's own name to show it alone.
      const text = clean(title)
      if (text === null || text.length > TITLE_MAX) throw 'invalid_args'
      state.title = text === current().manifest.name ? null : text
      renderChrome()
      return null
    },
    notify: ([notice]) => {
      need('notify')
      if (!notice || typeof notice !== 'object') throw 'invalid_args'
      const title = clean(notice.title)
      if (title === null || title.length > NOTIFY_TITLE_MAX) throw 'invalid_args'
      if (notice.body != null && typeof notice.body !== 'string') throw 'invalid_args'
      const body = clean(notice.body) || ''
      if (body.length > NOTIFY_BODY_MAX) throw 'invalid_args'
      if (Date.now() - state.lastNotify < NOTIFY_EVERY_MS) throw 'rate_limited'
      state.lastNotify = Date.now()
      log(`notify: ${title}${body ? `: ${body}` : ''}`, 'note')
      return null
    },
    openUrl: ([url]) => {
      need('open-url')
      if (typeof url !== 'string' || url.length > OPEN_URL_MAX) throw 'invalid_args'
      let parsed
      try { parsed = new URL(url) } catch { throw 'invalid_args' }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw 'invalid_args'
      if (!frameFocused()) throw 'not_focused'
      if (!confirm(`Open ${parsed.host} in your browser?`)) throw 'declined'
      window.open(parsed.href, '_blank', 'noopener')
      return null
    },
    'clipboard.write': async ([text]) => {
      need('clipboard-write')
      if (typeof text !== 'string') throw 'invalid_args'
      if (new Blob([text]).size > CLIPBOARD_MAX) throw 'too_large'
      if (!frameFocused()) throw 'not_focused'
      try { await navigator.clipboard.writeText(text) } catch { throw 'host_error' }
      return null
    },
    'extras.set': ([fields]) => {
      if (!current().manifest.contributes.extras) throw 'permission_denied'
      if (!fields || typeof fields !== 'object') throw 'invalid_args'
      if (Object.keys(fields).some((k) => !['state', 'progress', 'until', 'control'].includes(k))) throw 'invalid_args'
      const next = { ...state.extras }
      if ('state' in fields) {
        if (fields.state !== null && typeof fields.state !== 'string') throw 'invalid_args'
        const text = fields.state === null ? null : clean(fields.state)
        if (text !== null && text.length > STATE_MAX) throw 'invalid_args'
        next.state = text
      }
      if ('progress' in fields) {
        const p = fields.progress
        if (p !== null && (typeof p !== 'number' || p < 0 || p > 1)) throw 'invalid_args'
        next.progress = p
      }
      if ('until' in fields) {
        if (fields.until !== null && typeof fields.until !== 'number') throw 'invalid_args'
        next.until = fields.until
      }
      if ('control' in fields) {
        if (fields.control !== null && !CONTROLS.includes(fields.control)) throw 'invalid_args'
        next.control = fields.control
      }
      state.extras = next
      renderExtras()
      return null
    },
  }

  function need(permission) {
    if (!current().manifest.permissions.includes(permission)) throw 'permission_denied'
  }

  window.addEventListener('message', async (event) => {
    if (!state.frame || event.source !== state.frame.contentWindow) return
    const msg = event.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'deska:ready') {
      post({ type: 'deska:init', payload: initPayload() })
      log('ready, init sent')
      return
    }
    if (msg.type !== 'deska:call') return
    const { id, method, args } = msg
    const answer = (ok, valueOrError) =>
      post(ok ? { type: 'deska:result', id, ok, value: valueOrError } : { type: 'deska:result', id, ok, error: valueOrError })
    if (rateLimited()) return answer(false, 'rate_limited')
    const fn = methods[method]
    if (!fn) {
      log(`${method}: unknown_method`, 'err')
      return answer(false, 'unknown_method')
    }
    try {
      const value = await fn(Array.isArray(args) ? args : [])
      if (!method.startsWith('storage.get') && method !== 'storage.keys') log(`${method}(${short(args)})`)
      answer(true, value === undefined ? null : value)
    } catch (code) {
      const error = typeof code === 'string' ? code : 'host_error'
      log(`${method}: ${error}`, 'err')
      answer(false, error)
    }
  })

  function short(args) {
    const s = JSON.stringify(args ?? [])
    return s.length > 80 ? `${s.slice(1, 78)}…` : s.slice(1, -1)
  }

  // --- rendering ---------------------------------------------------------------
  function renderChrome() {
    const p = current()
    $('chrome-title').textContent = state.title ? `${p.manifest.name}: ${state.title}` : p.manifest.name
    $('chrome-icon').src = p.manifest.icon ? `${p.origin}/${p.manifest.icon}` : ''
    $('chrome-icon').hidden = !p.manifest.icon
  }

  function renderExtras() {
    const p = current()
    const ex = p.manifest.contributes.extras
    $('extras-box').hidden = !ex
    if (!ex) return
    $('extras-title').textContent = ex.title
    $('extras-icon').src = p.manifest.icon ? `${p.origin}/${p.manifest.icon}` : ''
    const left = state.extras.until ? Math.max(0, state.extras.until - Date.now()) : null
    const clock = left === null ? '' : `${formatLeft(left)} left`
    $('extras-state').textContent = [state.extras.state, clock].filter(Boolean).join(', ') || 'Nothing set'
    $('extras-ring').style.setProperty('--p', state.extras.progress ?? 0)
    const control = state.extras.control
    $('extras-control').hidden = !control
    $('extras-control').textContent = { play: '▶', pause: '❚❚', start: '▶', stop: '■' }[control] || ''
    $('extras-control').setAttribute('aria-label', control || '')
  }

  function formatLeft(ms) {
    const s = Math.ceil(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
  }
  setInterval(() => state.extras.until && renderExtras(), 1000)

  function mount() {
    const p = current()
    const ex = p.manifest.contributes.extras
    const entry = state.place === 'extras' && ex ? ex.view || p.manifest.contributes.panel.entry : p.manifest.contributes.panel.entry
    const size = state.place === 'extras' ? { width: 340, height: 360 } : p.manifest.contributes.panel.size || { width: 420, height: 320 }
    const chrome = $('chrome')
    chrome.style.width = `${size.width}px`
    chrome.style.height = `${size.height + 32}px`
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts allow-forms')
    frame.setAttribute('allow', "focus-without-user-activation 'none'")
    frame.title = p.manifest.name
    frame.src = `${p.origin}/${entry}`
    $('frame-box').replaceChildren(frame)
    state.frame = frame
    state.title = null
    document.body.style.colorScheme = state.theme
    renderChrome()
    renderExtras()
    const url = new URL(location.href)
    url.searchParams.set('panel', p.id)
    url.searchParams.set('theme', state.theme)
    url.searchParams.set('place', state.place)
    history.replaceState(null, '', url)
    log(`mounted ${p.id} ${p.manifest.version} (${state.place}, ${state.theme})`)
  }

  function press(group, attr, value) {
    for (const b of document.querySelectorAll(`[${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value))
  }

  document.querySelectorAll('[data-theme]').forEach((b) =>
    b.addEventListener('click', () => {
      state.theme = b.dataset.theme
      press('theme', 'data-theme', state.theme)
      post({ type: 'deska:theme', payload: themePayload() })
      const url = new URL(location.href)
      url.searchParams.set('theme', state.theme)
      history.replaceState(null, '', url)
      log(`theme: ${state.theme}`)
    }),
  )
  document.querySelectorAll('[data-place]').forEach((b) =>
    b.addEventListener('click', () => {
      state.place = b.dataset.place
      press('place', 'data-place', state.place)
      mount()
    }),
  )
  for (const id of ['visible', 'idle']) {
    $(id).addEventListener('change', () => {
      state.visible = $('visible').checked
      state.idle = $('idle').checked
      post({ type: 'deska:visibility', payload: visibilityPayload() })
      log(`visibility: ${JSON.stringify(visibilityPayload())}`)
    })
  }
  $('extras-control').addEventListener('click', () => {
    const control = state.extras.control
    if (!control) return
    post({ type: 'deska:event', name: 'extras.control', payload: { control } })
    log(`extras.control: ${control}`)
  })
  $('reload').addEventListener('click', mount)
  $('clear-storage').addEventListener('click', () => {
    localStorage.removeItem(storeKey())
    log('storage cleared')
    mount()
  })
  select.addEventListener('change', () => {
    state.extras = {}
    mount()
  })

  press('theme', 'data-theme', state.theme)
  press('place', 'data-place', state.place)
  mount()

  // For automated checks: tools/check.mjs reads this.
  window.__preview = {
    setTheme: (t) => document.querySelector(`[data-theme="${t}"]`).click(),
    setVisibility: (visible, idle = false) => {
      $('visible').checked = visible
      $('idle').checked = idle
      $('visible').dispatchEvent(new Event('change'))
    },
    extras: () => ({ ...state.extras }),
    title: () => state.title,
    pressControl: () => $('extras-control').click(),
    log: () => [...$('log').children].map((li) => li.textContent),
  }
})()
