// Reading any CSS color, and WCAG 2 contrast. No bridge calls here.

const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

/** Any color CSS understands (#abc, rgb(), hsl(), oklch(), names) as
 *  { r, g, b, a } with r, g, b in 0 to 255 and a in 0 to 1, or null. The
 *  canvas does the parsing, so the panel understands what the browser does. */
export function parseColor(text) {
  const value = text.trim()
  if (!value || !CSS.supports('color', value)) return null
  ctx.canvas.width = ctx.canvas.height = 1
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  // getImageData returns premultiplied-then-unpremultiplied values; fine for
  // alpha 1, and close enough for a translucent text color.
  return { r, g, b, a: alpha / 255 }
}

export function toHex({ r, g, b }) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}

/** Paints a translucent color over an opaque one. */
export function over(top, under) {
  const a = top.a
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }
}

// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
export function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG says to compare without rounding up: 4.499 fails 4.5. Shows two
 *  decimals, cut rather than rounded, so the number never claims a pass. */
export function formatRatio(ratio) {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`
}

const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 })
const round = (c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 })

/** The text color closest to `fg` (by mixing toward black or white, which
 *  keeps its hue) that reaches `target` on `bg`. null when even black or
 *  white cannot. */
export function nearestPassing(fg, bg, target) {
  const black = { r: 0, g: 0, b: 0, a: 1 }
  const white = { r: 255, g: 255, b: 255, a: 1 }
  const candidates = []
  for (const end of [black, white]) {
    if (contrast(end, bg) < target) continue
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (contrast(round(mix(fg, end, mid)), bg) >= target) hi = mid
      else lo = mid
    }
    let color = round(mix(fg, end, hi))
    // Rounding to whole channels can land a hair under; step until it passes.
    for (let step = 0; contrast(color, bg) < target && step < 8; step++) color = round(mix(color, end, 0.02))
    candidates.push({ color, distance: hi })
  }
  candidates.sort((x, y) => x.distance - y.distance)
  return candidates[0]?.color ?? null
}
