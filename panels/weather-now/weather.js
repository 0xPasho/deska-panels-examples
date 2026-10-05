// WMO weather codes (what Open-Meteo returns as weather_code) in plain words,
// and the small monochrome icons drawn for them. The icons are inline SVG in
// the package: a panel's CSP refuses remote images and icon fonts, and
// currentColor lets them follow the theme's text color.

const CONDITIONS = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'partly'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Heavy freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm with hail', 'thunder'],
  99: ['Thunderstorm with heavy hail', 'thunder'],
}

/** Plain words and an icon name for a WMO code. Night swaps the sun for a moon. */
export function describe(code, isDay = true) {
  const [words, icon] = CONDITIONS[code] ?? ['Unknown', 'cloud']
  if (!isDay && icon === 'clear') return { words, icon: 'moon' }
  if (!isDay && icon === 'partly') return { words, icon: 'partly-night' }
  return { words, icon }
}

const CLOUD = 'M6.5 18.5h11a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.2 10.1 4.2 4.2 0 0 0 6.5 18.5Z'
const CLOUD_HIGH = 'M6.5 15h11a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.2 6.6 4.2 4.2 0 0 0 6.5 15Z'
const SUN_RAYS = 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'
const MOON = 'M19.5 14.2A7.5 7.5 0 1 1 9.8 4.5a6 6 0 0 0 9.7 9.7Z'
// The small cloud in "partly" is filled with the panel ground so it hides the sun behind it.
const PARTLY_CLOUD = '<path class="knock" d="M10 20h8.4a2.9 2.9 0 0 0 .3-5.78A4.4 4.4 0 0 0 10.6 13.2 3.4 3.4 0 0 0 10 20Z"/>'

const SHAPES = {
  clear: `<circle cx="12" cy="12" r="4"/><path d="${SUN_RAYS}"/>`,
  moon: `<path d="${MOON}"/>`,
  partly: `<circle cx="9" cy="9" r="3.2"/><path d="M9 2.8v1.4M2.8 9h1.4M4.6 4.6l1 1M13.4 4.6l-1 1M4.6 13.4l1-1"/>${PARTLY_CLOUD}`,
  'partly-night': `<path d="M13.2 10.4A5 5 0 1 1 7.6 3.8a4 4 0 0 0 5.6 6.6Z"/>${PARTLY_CLOUD}`,
  cloud: `<path d="${CLOUD}"/>`,
  fog: `<path d="${CLOUD_HIGH}"/><path d="M5 18.5h14M7.5 21.5h9"/>`,
  drizzle: `<path d="${CLOUD_HIGH}"/><path d="M8.5 18.5v.5M12 19.5v.5M15.5 18.5v.5M10 21.5v.5M14 21.5v.5"/>`,
  rain: `<path d="${CLOUD_HIGH}"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>`,
  snow: `<path d="${CLOUD_HIGH}"/><path d="M8.5 18.5h.01M12 20h.01M15.5 18.5h.01M10 22h.01M14 22h.01"/>`,
  thunder: `<path d="${CLOUD_HIGH}"/><path d="M12.5 16l-2 3.5h3l-2 3.5"/>`,
}

/** An inline SVG string for an icon name. Only ever built from the constants above. */
export function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${SHAPES[name] ?? SHAPES.cloud}</svg>`
}

export const UI_ICONS = {
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
}
