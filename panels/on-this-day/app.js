// On This Day: today's events in history, the featured article and the
// picture of the day from Wikipedia, in the person's language.
//
// What this panel teaches:
// - init.locale from deska.ready(): picking an interface language, an Intl
//   date format and a per-language Wikipedia host (i18n.js, wiki.js).
// - deska.storage as a cache: today's feed paints instantly on reload and is
//   fetched again only when the calendar day changes.
// - Images from hosts declared in panel.json "network" (img-src), loaded
//   lazily, with a broken image removed instead of shown.
// - deska.openUrl from a click, handling not_focused and declined.

import { capitalize, interfaceLocale, translator } from './i18n.js'
import { LANGUAGES, dayKey, fetchDay, homeUrl, wikiLanguageFor } from './wiki.js'

const $ = (id) => document.getElementById(id)
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const DAY_CHECK_MS = 60_000
const NOTICE_MS = 4000

const state = {
  t: translator('en'),
  intl: 'en',
  lang: 'en',
  tab: 'events',
  feed: null,
  status: 'loading', // loading | ready | error
  offline: false,
  controller: null,
}

// --- storage ---------------------------------------------------------------
// localStorage throws in the sandboxed frame (its origin is opaque), so
// everything that should survive a reload goes through deska.storage. A
// failed read just means a cold start; it is logged with its code.
async function read(key) {
  try {
    return await deska.storage.get(key)
  } catch (err) {
    console.warn(`storage.get("${key}") failed: ${err.code}`)
    return null
  }
}

async function save(key, value) {
  try {
    await deska.storage.set(key, value)
  } catch (err) {
    // storage_full: the package's 256 KB are used up. The cache is only a
    // convenience, so the panel keeps working without it.
    console.warn(`storage.set("${key}") failed: ${err.code}`)
  }
}

// --- links -----------------------------------------------------------------
const LINK_ERRORS = { not_focused: 'notFocused', declined: 'declined', permission_denied: 'noPermission' }

// The frame cannot navigate or open windows; deska.openUrl asks Deska to
// open the page in the browser. It only works while the frame has focus,
// which is why every caller is a click or key handler.
async function open(url) {
  if (!url) return
  try {
    await deska.openUrl(url)
  } catch (err) {
    // rate_limited means a double click: the first one is already opening.
    if (err.code === 'rate_limited') return
    showNotice(state.t(LINK_ERRORS[err.code] ?? 'openFailed'))
  }
}

let noticeTimer = null
function showNotice(text, sticky = false) {
  const el = $('notice')
  el.textContent = text
  el.hidden = false
  clearTimeout(noticeTimer)
  if (!sticky) noticeTimer = setTimeout(() => (el.hidden = true), NOTICE_MS)
}

function hideNotice() {
  clearTimeout(noticeTimer)
  $('notice').hidden = true
}

// --- loading ---------------------------------------------------------------
async function load() {
  state.controller?.abort()
  const controller = new AbortController()
  state.controller = controller
  state.status = 'loading'
  render()
  try {
    const feed = await fetchDay(state.lang, new Date(), controller.signal)
    state.feed = feed
    state.status = 'ready'
    state.offline = false
    hideNotice()
    await save('feed', feed)
  } catch (err) {
    if (controller.signal.aborted) return
    state.offline = !navigator.onLine
    state.status = 'error'
    console.warn('Wikipedia feed failed:', err.message)
  } finally {
    if (state.controller === controller) state.controller = null
  }
  render()
}

const isCurrent = (feed) => feed && feed.lang === state.lang && feed.day === dayKey()

// Refetch only when the calendar day has moved on since the cached feed.
function checkDay() {
  renderDate()
  if (state.status !== 'loading' && state.feed && state.feed.day !== dayKey()) load()
}

// --- rendering -------------------------------------------------------------
function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

// Thumbnails come from upload.wikimedia.org and thumb.wikimedia.org, both in
// panel.json "network", which is what puts them under img-src. loading=lazy
// keeps forty rows from fetching forty images up front; a picture that
// fails (deleted file, offline) is removed so no broken icon shows.
function image(src, className, alt, onBroken) {
  const img = el('img', className)
  img.src = src
  img.alt = alt
  img.loading = 'lazy'
  img.decoding = 'async'
  img.addEventListener('error', () => {
    img.remove()
    onBroken?.()
  })
  return img
}

function renderDate() {
  const text = new Intl.DateTimeFormat(state.intl, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  $('date').textContent = capitalize(text, state.intl)
}

function yearLabel(year) {
  return year < 0 ? state.t('yearBc', -year) : String(year)
}

function eventRow(event) {
  const li = el('li')
  const row = el(event.url ? 'button' : 'div', 'event')
  if (event.url) {
    row.type = 'button'
    row.addEventListener('click', () => open(event.url))
  }
  row.append(el('span', 'year', yearLabel(event.year)), el('span', 'text', capitalize(event.text, state.lang)))
  if (event.thumb) {
    row.classList.add('has-thumb')
    row.append(image(event.thumb, 'thumb', '', () => row.classList.remove('has-thumb')))
  }
  li.append(row)
  return li
}

function eventsView(feed) {
  if (!feed.events.length) return el('p', 'state', state.t('empty'))
  const list = el('ol', 'events')
  list.lang = feed.lang
  list.append(...feed.events.map(eventRow))
  return list
}

function articleSection(article) {
  const section = el('section', 'section')
  section.append(el('h2', 'section-title', state.t('featuredArticle')))
  const body = el('div', 'article')
  if (article.thumb) body.append(image(article.thumb, 'article-thumb', ''))
  const title = el('button', 'article-title', article.title)
  title.type = 'button'
  title.addEventListener('click', () => open(article.url))
  body.append(title)
  if (article.description) body.append(el('p', 'article-description', capitalize(article.description, state.lang)))
  body.append(el('p', 'article-extract', article.extract))
  section.append(body)
  return section
}

function pictureSection(picture) {
  const section = el('section', 'section')
  section.append(el('h2', 'section-title', state.t('pictureOfTheDay')))
  const figure = el('figure', 'picture')
  const frame = el('button', 'picture-frame')
  frame.type = 'button'
  frame.setAttribute('aria-label', state.t('openFile'))
  frame.style.aspectRatio = `${picture.width} / ${picture.height}`
  frame.addEventListener('click', () => open(picture.url))
  frame.append(image(picture.thumb, 'picture-image', picture.description, () => frame.remove()))
  figure.append(frame)
  const caption = el('figcaption')
  if (picture.description) caption.append(el('p', 'picture-description', picture.description))
  const credit = [picture.artist && state.t('by', picture.artist), picture.license].filter(Boolean).join(', ')
  if (credit) caption.append(el('p', 'picture-credit', credit))
  figure.append(caption)
  section.append(figure)
  return section
}

function featuredView(feed) {
  // Not every Wikipedia features an article in its daily feed (Spanish,
  // French, Portuguese and Italian do not), so each section shows only when
  // the feed has it.
  const sections = [feed.article && articleSection(feed.article), feed.picture && pictureSection(feed.picture)].filter(Boolean)
  if (!sections.length) return el('p', 'state', state.t('noFeatured'))
  const wrap = el('div', 'featured')
  wrap.lang = feed.lang
  wrap.append(...sections)
  return wrap
}

function errorView() {
  const box = el('div', 'state')
  box.append(el('p', null, state.t(state.offline ? 'offline' : 'error')))
  const retry = el('button', 'quiet-button', state.t('retry'))
  retry.type = 'button'
  retry.addEventListener('click', load)
  box.append(retry)
  return box
}

function render() {
  const view = $('view')
  const loading = state.status === 'loading'
  view.setAttribute('aria-busy', String(loading))
  $('refresh').setAttribute('aria-disabled', String(loading))

  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === state.tab
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
  }
  view.setAttribute('aria-labelledby', `tab-${state.tab}`)

  // A feed for this language stays on screen while a newer one loads, and
  // when a refresh fails (offline): stale history beats an empty panel.
  const feed = state.feed?.lang === state.lang ? state.feed : null
  let content
  if (feed) content = state.tab === 'events' ? eventsView(feed) : featuredView(feed)
  else if (loading) content = el('p', 'state', state.t('loading'))
  else content = errorView()

  if (feed && state.status === 'error') showNotice(state.t(state.offline ? 'offlineCached' : 'error'), true)

  const keepScroll = view.dataset.shown === `${feed?.lang}:${feed?.day}:${state.tab}`
  const scroll = view.scrollTop
  view.replaceChildren(content)
  view.scrollTop = keepScroll ? scroll : 0
  view.dataset.shown = `${feed?.lang}:${feed?.day}:${state.tab}`
}

// --- controls --------------------------------------------------------------
function selectTab(tab, moveFocus) {
  state.tab = tab
  save('tab', tab)
  render()
  // Focus moves only because the person pressed an arrow key in the tab list.
  if (moveFocus) $(`tab-${tab}`).focus()
}

function wireControls() {
  const { t } = state
  document.documentElement.lang = state.intl
  $('lang-label').textContent = t('language')
  $('lang').setAttribute('aria-label', t('language'))
  $('refresh').setAttribute('aria-label', t('refresh'))
  $('refresh').title = t('refresh')
  $('tabs').setAttribute('aria-label', t('tabs'))
  $('tab-events').textContent = t('events')
  $('tab-featured').textContent = t('featured')
  $('credit-source').textContent = t('fromWikipedia')
  $('credit-license').setAttribute('aria-label', t('licenseLabel'))

  // Each language names itself ("Español", "Deutsch"), so the person can find
  // theirs whatever language the panel is currently in.
  const select = $('lang')
  for (const code of LANGUAGES) {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    select.add(new Option(capitalize(name, code), code))
  }
  select.value = state.lang
  select.addEventListener('change', () => {
    state.lang = select.value
    save('lang', state.lang)
    load()
  })

  $('refresh').addEventListener('click', () => {
    if (state.status !== 'loading') load()
  })

  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => selectTab(tab.dataset.tab, false))
  $('tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    selectTab(state.tab === 'events' ? 'featured' : 'events', true)
  })

  $('credit-source').addEventListener('click', () => open(homeUrl(state.lang)))
  $('credit-license').addEventListener('click', () => open(LICENSE_URL))

  window.addEventListener('online', () => {
    if (state.status === 'error') load()
  })
}

// --- start -----------------------------------------------------------------
async function start() {
  // init.locale is the language Deska runs in, such as "es-MX". It picks the
  // panel's words, the date format and, unless the person chose another one,
  // which Wikipedia to read.
  const init = await deska.ready()
  const ui = interfaceLocale(init.locale)
  state.t = translator(ui.lang)
  state.intl = ui.intl

  const [savedLang, savedTab, cached] = await Promise.all([read('lang'), read('tab'), read('feed')])
  state.lang = LANGUAGES.includes(savedLang) ? savedLang : wikiLanguageFor(init.locale)
  state.tab = savedTab === 'featured' ? 'featured' : 'events'

  wireControls()
  renderDate()

  // Today's feed from storage paints with no network at all.
  if (isCurrent(cached)) {
    state.feed = cached
    state.status = 'ready'
    render()
  } else {
    load()
  }

  // The day can change while the panel stays open. Checking once a minute is
  // cheap; Deska says when the panel comes back into view, which catches a
  // laptop that slept past midnight.
  setInterval(() => deska.visible && checkDay(), DAY_CHECK_MS)
  deska.on('visibility', ({ visible }) => visible && checkDay())
}

start()
