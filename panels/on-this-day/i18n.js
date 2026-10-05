// The panel's own words, one small dictionary per language. Keys stay in
// English; a language that lacks a key falls back to English, so adding a
// language can start with a few strings and grow.

const STRINGS = {
  en: {
    language: 'Wikipedia language',
    refresh: 'Refresh',
    tabs: 'Sections',
    events: 'On this day',
    featured: 'Featured',
    loading: 'Loading today from Wikipedia',
    error: 'Could not reach Wikipedia.',
    offline: 'You are offline. Connect and try again.',
    offlineCached: 'You are offline, showing what was saved earlier.',
    retry: 'Try again',
    empty: 'Wikipedia lists no events for this day in this language.',
    featuredArticle: 'Featured article',
    pictureOfTheDay: 'Picture of the day',
    noFeatured: 'Nothing is featured for this day in this language yet.',
    openFile: 'Open the file page',
    by: (artist) => `By ${artist}`,
    yearBc: (n) => `${n} BC`,
    fromWikipedia: 'From Wikipedia',
    licenseLabel: 'Text license: CC BY-SA 4.0',
    notFocused: 'Click the panel first, then open the link again.',
    declined: 'The link was not opened.',
    openFailed: 'Could not open the link.',
    noPermission: 'This panel may not open links.',
  },
  es: {
    language: 'Idioma de Wikipedia',
    refresh: 'Actualizar',
    tabs: 'Secciones',
    events: 'Tal día como hoy',
    featured: 'Destacado',
    loading: 'Cargando el día desde Wikipedia',
    error: 'No se pudo conectar con Wikipedia.',
    offline: 'Sin conexión. Conéctate e inténtalo de nuevo.',
    offlineCached: 'Sin conexión, se muestra lo guardado antes.',
    retry: 'Reintentar',
    empty: 'Wikipedia no tiene efemérides para este día en este idioma.',
    featuredArticle: 'Artículo destacado',
    pictureOfTheDay: 'Imagen del día',
    noFeatured: 'Todavía no hay nada destacado para este día en este idioma.',
    openFile: 'Abrir la página del archivo',
    by: (artist) => `Por ${artist}`,
    yearBc: (n) => `${n} a. C.`,
    fromWikipedia: 'De Wikipedia',
    licenseLabel: 'Licencia del texto: CC BY-SA 4.0',
    notFocused: 'Haz clic en el panel y vuelve a abrir el enlace.',
    declined: 'No se abrió el enlace.',
    openFailed: 'No se pudo abrir el enlace.',
    noPermission: 'Este panel no puede abrir enlaces.',
  },
}

/** The base language of a BCP 47 tag: "es-MX" gives "es". */
export const baseLanguage = (locale) => String(locale || '').toLowerCase().split(/[-_]/)[0]

/**
 * Picks the interface language and the locale Intl should format with.
 * A Mexican Spanish locale keeps "es-MX" for dates; an unsupported one
 * (say "ko-KR") gets English words and an English date, never a mix.
 */
export function interfaceLocale(locale) {
  const base = baseLanguage(locale)
  return STRINGS[base] ? { lang: base, intl: locale } : { lang: 'en', intl: 'en' }
}

/** Returns t(key, ...args) for one language. */
export function translator(lang) {
  const table = STRINGS[lang] || STRINGS.en
  return (key, ...args) => {
    const value = table[key] ?? STRINGS.en[key] ?? key
    return typeof value === 'function' ? value(...args) : value
  }
}

/** "lunes, 5 de octubre" becomes "Lunes, 5 de octubre" for a heading. */
export function capitalize(text, locale) {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text
}
