// Seeded generators: the same seed always gives the same output, so a reload
// shows what you saw and Shuffle is just a new seed. No DOM, no bridge.

/** mulberry32: a tiny, fast, good-enough PRNG for fake data (not for secrets). */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (r, list) => list[Math.floor(r() * list.length)]
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))

// Text ------------------------------------------------------------------------------

const LATIN = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud ' +
  'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur ' +
  'sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum praesent sagittis massa nec metus vestibulum pellentesque ' +
  'habitant morbi tristique senectus netus malesuada fames turpis egestas integer feugiat scelerisque varius quam nulla facilisi cras fermentum odio eu'
).split(' ')

const CLASSIC = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'

function sentence(r) {
  const n = between(r, 6, 14)
  const words = Array.from({ length: n }, () => pick(r, LATIN))
  // A comma in some longer sentences reads more like prose.
  if (n > 8 && r() < 0.6) words[between(r, 3, n - 4)] += ','
  const text = words.join(' ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

function paragraph(r) {
  return Array.from({ length: between(r, 3, 6) }, () => sentence(r)).join(' ')
}

export function text(seed, unit, count, classic) {
  const r = rng(seed)
  if (unit === 'words') {
    const words = Array.from({ length: count }, () => pick(r, LATIN))
    if (classic) CLASSIC.replace(/[,.]/g, '').toLowerCase().split(' ').slice(0, count).forEach((w, i) => (words[i] = w))
    const out = words.join(' ')
    return out[0].toUpperCase() + out.slice(1)
  }
  if (unit === 'sentences') {
    const list = Array.from({ length: count }, () => sentence(r))
    if (classic) list[0] = CLASSIC
    return list.join(' ')
  }
  const list = Array.from({ length: count }, () => paragraph(r))
  if (classic) list[0] = `${CLASSIC} ${list[0]}`
  return list.join('\n\n')
}

// People ------------------------------------------------------------------------------

const FIRST = ['Ada', 'Amara', 'Aiko', 'Bruno', 'Camila', 'Chen', 'Dmitri', 'Elif', 'Farah', 'Gabriel', 'Hana', 'Ines', 'Jamal', 'Kofi', 'Lucia', 'Mateo', 'Mei', 'Nadia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sven', 'Tomás', 'Uma', 'Valentina', 'Wei', 'Yusuf', 'Zara', 'Noah', 'Leila', 'Ravi']
const LAST = ['Okafor', 'Silva', 'Tanaka', 'Novak', 'García', 'Haddad', 'Kim', 'Müller', 'Rossi', 'Nguyen', 'Petrov', 'Mensah', 'Johansson', 'Patel', 'Cohen', 'Moreau', 'Kowalski', 'Ali', 'Fernández', 'Lindqvist', 'Abara', 'Yamamoto', "O'Brien", 'Dubois']
const COMPANIES = ['Northwind', 'Bluebird Labs', 'Harbor & Pine', 'Quiet Signal', 'Paper Lantern', 'Orbit Supply', 'Fieldnote', 'Copperleaf', 'Lumen Works', 'Tidewater']
const CITIES = ['Lisbon', 'Nairobi', 'Osaka', 'Bogotá', 'Toronto', 'Berlin', 'Melbourne', 'Seoul', 'Cape Town', 'Mexico City', 'Oslo', 'Mumbai']
const ROLES = ['Engineer', 'Designer', 'Product manager', 'Researcher', 'Support lead', 'Data analyst', 'Writer', 'Founder']

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

export function people(seed, count) {
  const r = rng(seed)
  return Array.from({ length: count }, (_, i) => {
    const first = pick(r, FIRST)
    const last = pick(r, LAST)
    return {
      id: i + 1,
      name: `${first} ${last}`,
      // example.com is reserved for examples: these addresses reach nobody.
      email: `${slug(first)}.${slug(last)}@example.com`,
      role: pick(r, ROLES),
      company: pick(r, COMPANIES),
      city: pick(r, CITIES),
      // 555-0100 to 555-0199 are set aside for fiction in North America.
      phone: `+1 555 01${String(between(r, 0, 99)).padStart(2, '0')}`,
      joined: new Date(Date.UTC(2020, 0, 1) + between(r, 0, 2000) * 864e5).toISOString().slice(0, 10),
    }
  })
}

export function uuids(seed, count) {
  const r = rng(seed)
  return Array.from({ length: count }, () => {
    const bytes = Array.from({ length: 16 }, () => Math.floor(r() * 256))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  })
}

// Formats -------------------------------------------------------------------------------

export function asJson(rows) {
  return JSON.stringify(rows, null, 2)
}

export function asCsv(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  return [cols.join(','), ...rows.map((row) => cols.map((c) => cell(row[c])).join(','))].join('\n')
}

export function asMarkdown(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v) => String(v).replaceAll('|', '\\|')
  return [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${cols.map((c) => cell(row[c])).join(' | ')} |`)].join('\n')
}
