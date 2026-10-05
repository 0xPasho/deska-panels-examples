#!/usr/bin/env node
// Preview host for Deska community panels.
//
//   node tools/preview/server.mjs panels/team-clocks [panels/other ...] [--port 5170]
//   node tools/preview/server.mjs --all
//
// Serves each panel on an origin of its own (like deska-panel://<id>/ in
// Deska), with the same Content-Security-Policy Deska sends, the same
// sandbox, and the SDK at /__deska/sdk.js. The host page at
// http://127.0.0.1:<port>/ plays Deska's side of the bridge: init, theme,
// visibility, storage, notify, openUrl, clipboard and Extras.
//
// It is a stand-in for building fast. Before you publish, load the folder in
// Deska itself (Panel Library, Build a panel, Load a folder): that is the
// runtime your panel ships to.

import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, extname, dirname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPanelFolder } from '../lib/manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/** The policy Deska builds from a manifest (buildPanelCsp in Deska). */
export function buildPanelCsp(network, origin) {
  const hosts = network.map((h) => `https://${h}`)
  const withHosts = (base) => [...base, ...hosts].join(' ')
  return [
    "default-src 'none'",
    `script-src ${origin} 'unsafe-inline'`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${withHosts([origin, 'data:', 'blob:'])}`,
    `font-src ${withHosts([origin, 'data:'])}`,
    `media-src ${withHosts([origin, 'blob:'])}`,
    `connect-src ${withHosts([origin])}`,
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts allow-forms',
  ].join('; ')
}

function parseArgs(argv) {
  const out = { port: 5170, dirs: [], all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--all') out.all = true
    else out.dirs.push(a)
  }
  return out
}

async function allPanelDirs() {
  const base = join(root, 'panels')
  const names = (await readdir(base)).sort()
  const dirs = []
  for (const name of names) {
    const dir = join(base, name)
    if ((await stat(dir)).isDirectory() && existsSync(join(dir, 'panel.json'))) dirs.push(dir)
  }
  return dirs
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

async function servePanel(panel, req, res) {
  const url = new URL(req.url, 'http://x')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Only GET and HEAD')
  let path = decodeURIComponent(url.pathname)
  if (path === '/__deska/sdk.js') {
    const sdk = await readFile(join(here, 'sdk.js'))
    return send(res, 200, sdk, {
      'Content-Type': TYPES['.js'],
      'Content-Security-Policy': panel.csp,
      'Access-Control-Allow-Origin': '*',
    })
  }
  if (path.endsWith('/')) path += 'index.html'
  const rel = normalize(path).replace(/^[/\\]+/, '')
  const file = join(panel.dir, rel)
  const type = TYPES[extname(file).toLowerCase()]
  if (!type || !file.startsWith(panel.dir + sep) || rel.split(sep).some((s) => s.startsWith('.'))) {
    return send(res, 404, 'Not found')
  }
  try {
    const body = await readFile(file)
    send(res, 200, req.method === 'HEAD' ? '' : body, {
      'Content-Type': type,
      'Content-Security-Policy': panel.csp,
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    })
  } catch {
    send(res, 404, 'Not found')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dirs = args.all || args.dirs.length === 0 ? await allPanelDirs() : args.dirs.map((d) => resolve(d))
  const panels = []
  let port = args.port + 1
  for (const dir of dirs) {
    const check = await checkPanelFolder(dir)
    if (!check.ok) {
      console.error(`\n${dir}\n  ${check.errors.join('\n  ')}`)
      continue
    }
    for (const w of check.warnings) console.warn(`${check.manifest.id}: ${w}`)
    const origin = `http://127.0.0.1:${port}`
    const panel = { dir, port, origin, manifest: check.manifest, csp: buildPanelCsp(check.manifest.network, origin) }
    panels.push(panel)
    createServer((req, res) => servePanel(panel, req, res).catch(() => send(res, 500, 'Error'))).listen(port, '127.0.0.1')
    port++
  }
  if (panels.length === 0) {
    console.error('No panel passed the checks.')
    process.exit(1)
  }

  const hostFiles = { '/': 'host.html', '/host.js': 'host.js', '/host.css': 'host.css', '/themes.json': 'themes.json' }
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/panels.json') {
      const list = panels.map((p) => ({ id: p.manifest.id, origin: p.origin, manifest: p.manifest }))
      return send(res, 200, JSON.stringify(list), { 'Content-Type': TYPES['.json'] })
    }
    const name = hostFiles[url.pathname]
    if (!name) return send(res, 404, 'Not found')
    send(res, 200, await readFile(join(here, name)), { 'Content-Type': TYPES[extname(name)] })
  }).listen(args.port, '127.0.0.1', () => {
    console.log(`Deska panel preview: http://127.0.0.1:${args.port}/`)
    for (const p of panels) console.log(`  ${p.manifest.id.padEnd(22)} http://127.0.0.1:${args.port}/?panel=${p.manifest.id}`)
  })
}

main()
