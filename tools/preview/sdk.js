/* Deska panel SDK, version 1. Served by Deska at /__deska/sdk.js inside every
 * package. Load it as a classic script before any module that uses it:
 *   <script src="/__deska/sdk.js"></script>
 * Outside Deska, deska.ready() never resolves. */
(function (root) {
  'use strict'
  if (root.deska) return

  var SDK_VERSION = 1
  var READY_RETRY_MS = 250
  var parent = root.parent
  var embedded = !!parent && parent !== root
  var listeners = Object.create(null)
  var pending = Object.create(null)
  var queue = []
  var seq = 0
  var init = null
  var retry = null
  var resolveReady = null
  var readyPromise = new Promise(function (resolve) {
    resolveReady = resolve
  })

  function post(message) {
    parent.postMessage(message, '*')
  }

  function emit(name, payload) {
    var list = listeners[name]
    if (!list) return
    list.slice().forEach(function (fn) {
      try {
        fn(payload)
      } catch (err) {
        if (root.console) root.console.error('[deska] a "' + name + '" listener threw', err)
      }
    })
  }

  function applyTheme(theme) {
    var doc = root.document
    var el = doc && doc.documentElement
    if (!theme || typeof theme !== 'object' || !el || !el.style) return
    var tokens = theme.tokens && typeof theme.tokens === 'object' ? theme.tokens : {}
    Object.keys(tokens).forEach(function (name) {
      if (name.indexOf('--deska-') === 0 && typeof tokens[name] === 'string') el.style.setProperty(name, tokens[name])
    })
    el.style.setProperty('color-scheme', theme.mode === 'light' ? 'light' : 'dark')
  }

  function setTheme(theme) {
    if (!theme || typeof theme !== 'object') return
    api.theme = theme
    applyTheme(theme)
  }

  function setVisibility(visibility) {
    if (!visibility || typeof visibility !== 'object') return
    api.visible = visibility.visible !== false
    api.idle = visibility.idle === true
  }

  function settle(id, ok, result) {
    var entry = pending[id]
    if (!entry) return
    delete pending[id]
    if (ok) {
      entry.resolve(result)
      return
    }
    var code = typeof result === 'string' ? result : 'host_error'
    var error = new Error(code)
    error.code = code
    entry.reject(error)
  }

  function send(entry) {
    try {
      post({ type: 'deska:call', id: entry.id, method: entry.method, args: entry.args })
    } catch (err) {
      // postMessage refuses what it cannot copy: a function, a DOM node.
      settle(entry.id, false, 'invalid_args')
    }
  }

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      seq += 1
      var entry = { id: 'c' + seq, method: method, args: args }
      pending[entry.id] = { resolve: resolve, reject: reject }
      // Outside Deska nothing will ever answer: the call stays pending.
      if (!embedded) return
      if (init) send(entry)
      else queue.push(entry)
    })
  }

  function onInit(payload) {
    if (!payload || typeof payload !== 'object') return
    var first = !init
    init = payload
    api.place = payload.place === 'extras' ? 'extras' : 'panel'
    setVisibility(payload.visibility)
    setTheme(payload.theme)
    if (retry !== null) {
      root.clearInterval(retry)
      retry = null
    }
    if (!first) return
    var waiting = queue
    queue = []
    waiting.forEach(send)
    resolveReady(payload)
  }

  function onMessage(event) {
    if (event.source !== parent) return
    var data = event.data
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
    if (data.type === 'deska:init') {
      onInit(data.payload)
      return
    }
    if (!init) return
    if (data.type === 'deska:result') {
      if (typeof data.id === 'string') settle(data.id, data.ok === true, data.ok === true ? data.value : data.error)
      return
    }
    if (data.type === 'deska:theme') {
      setTheme(data.payload)
      emit('theme', data.payload)
      return
    }
    if (data.type === 'deska:visibility') {
      setVisibility(data.payload)
      emit('visibility', data.payload)
      return
    }
    if (data.type === 'deska:event' && typeof data.name === 'string') emit(data.name, data.payload)
  }

  function sayReady() {
    post({ type: 'deska:ready', sdk: SDK_VERSION })
  }

  var api = {
    theme: null,
    visible: true,
    idle: false,
    place: null,
    ready: function () {
      return readyPromise
    },
    storage: {
      get: function (key) {
        return call('storage.get', [key])
      },
      set: function (key, value) {
        return call('storage.set', [key, value])
      },
      remove: function (key) {
        return call('storage.remove', [key])
      },
      keys: function () {
        return call('storage.keys', [])
      }
    },
    setTitle: function (title) {
      return call('setTitle', [title])
    },
    notify: function (notice) {
      return call('notify', [notice])
    },
    openUrl: function (url) {
      return call('openUrl', [url])
    },
    clipboard: {
      write: function (text) {
        return call('clipboard.write', [text])
      }
    },
    extras: {
      set: function (fields) {
        return call('extras.set', [fields])
      }
    },
    on: function (name, fn) {
      if (typeof fn !== 'function') return function () {}
      var list = listeners[name] || (listeners[name] = [])
      list.push(fn)
      return function () {
        var index = list.indexOf(fn)
        if (index >= 0) list.splice(index, 1)
      }
    }
  }

  root.deska = api

  // The host may not be listening yet when this runs: say ready until it
  // answers, then never again.
  if (embedded) {
    root.addEventListener('message', onMessage)
    sayReady()
    retry = root.setInterval(sayReady, READY_RETRY_MS)
  }
})(typeof window !== 'undefined' ? window : globalThis)
