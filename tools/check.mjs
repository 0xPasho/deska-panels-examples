#!/usr/bin/env node
// Checks every panel (or the ones named) and captures screenshots.
//
//   npm run check                      every panel
//   npm run check -- team-clocks       one panel
//   npm run check -- --no-shots        skip the screenshots
//
// For each panel: the manifest and files pass the checks Deska runs, the page
// loads in the preview host under Deska's policy, says ready, and logs no
// errors and no policy violations, in the dark theme and the light one.
// Screenshots land in docs/screenshots/preview/<id>-<theme>.png.

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const shots = !args.includes('--no-shots')
const only = args.filter((a) => !a.startsWith('--'))
const PORT = Number(process.env.PREVIEW_PORT) || 20000 + Math.floor(Math.random() * 1000) * 40

// Messages Chromium prints for reasons a panel cannot control.
const IGNORED = [/Failed to load resource: the server responded with a status of 404 \(Not Found\).*favicon/]

const server = spawn(process.execPath, [join(root, 'tools/preview/server.mjs'), '--port', String(PORT), ...(only.length ? only.map((id) => join(root, 'panels', id)) : ['--all'])], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => (String(d).includes('preview:') ? ok() : null))
  server.on('exit', (code) => fail(new Error(`preview server exited with ${code}`)))
})

const panels = await (await fetch(`http://127.0.0.1:${PORT}/panels.json`)).json()
const browser = await chromium.launch()
await mkdir(join(root, 'docs/screenshots/preview'), { recursive: true })
let failed = 0

for (const panel of panels) {
  const problems = []
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return
    const text = msg.text()
    if (IGNORED.some((re) => re.test(text))) return
    if (msg.type() === 'error' || /Content Security Policy/i.test(text)) problems.push(`console ${msg.type()}: ${text}`)
  })
  page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`))

  const places = panel.manifest.contributes.extras ? ['panel', 'extras'] : ['panel']
  for (const place of places) {
    for (const theme of ['dark', 'light']) {
      await page.goto(`http://127.0.0.1:${PORT}/?panel=${panel.id}&theme=${theme}&place=${place}`)
      try {
        await page.waitForFunction(() => window.__preview?.log().some((l) => l.includes('ready, init sent')), null, { timeout: 8000 })
      } catch {
        problems.push(`${place}/${theme}: the page never called deska.ready() (is /__deska/sdk.js loaded?)`)
        continue
      }
      await page.waitForTimeout(2500)
      if (shots) {
        const suffix = place === 'extras' ? `extras-${theme}` : theme
        await page.locator('#chrome').screenshot({ path: join(root, `docs/screenshots/preview/${panel.id}-${suffix}.png`) })
      }
    }
  }
  const bridgeErrors = (await page.evaluate(() => window.__preview.log())).filter((l) => /: (unknown_method|invalid_args|permission_denied)$/.test(l))
  for (const l of bridgeErrors) problems.push(`bridge: ${l}`)
  await context.close()

  if (problems.length) {
    failed++
    console.log(`✗ ${panel.id}\n  ${[...new Set(problems)].join('\n  ')}`)
  } else {
    console.log(`✓ ${panel.id}`)
  }
}

await browser.close()
server.kill()
console.log(`\n${panels.length - failed} of ${panels.length} panels passed.`)
process.exit(failed ? 1 : 0)
