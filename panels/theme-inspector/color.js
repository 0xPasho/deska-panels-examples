// Color math for the contrast view. Deska sends every color token as a solid,
// resolved color (contract §7: translucent app colors are blended onto the
// panel ground first), so a contrast ratio can be computed straight from the
// value, with no alpha compositing.

// Today the values are hex. Parse hex and rgb() by hand, and let a canvas
// normalise anything else a future Deska might send (hsl, a named color).
export function parseColor(value) {
  const text = String(value || '').trim()
  return parseHex(text) || parseRgb(text) || parseWithCanvas(text)
}

function parseHex(text) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(text)
  if (!m) return null
  let hex = m[1]
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
  if (hex.length !== 6 && hex.length !== 8) return null
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function parseRgb(text) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  return m ? [m[1], m[2], m[3]].map((n) => Math.round(Math.min(255, Number(n)))) : null
}

let probe = null
function parseWithCanvas(text) {
  if (!text) return null
  probe ||= document.createElement('canvas').getContext('2d')
  // fillStyle keeps its old value when it does not understand the new one, so
  // set two different sentinels to tell "parsed" from "ignored".
  probe.fillStyle = '#000000'
  probe.fillStyle = text
  const first = probe.fillStyle
  probe.fillStyle = '#ffffff'
  probe.fillStyle = text
  if (first !== probe.fillStyle) return null
  return parseHex(first) || parseRgb(first)
}

// WCAG 2 relative luminance of an sRGB color.
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The verdict in words, for body text first.
export function verdict(ratio) {
  if (ratio >= 7) return { word: 'AAA', level: 'pass' }
  if (ratio >= 4.5) return { word: 'AA', level: 'pass' }
  if (ratio >= 3) return { word: 'Large only', level: 'warn' }
  return { word: 'Fails', level: 'fail' }
}
