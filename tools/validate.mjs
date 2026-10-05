#!/usr/bin/env node
// Runs Deska's package checks on every folder under panels/ (no browser).
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPanelFolder } from './lib/manifest.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const names = (await readdir(join(root, 'panels'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
let bad = 0
const ids = new Set()
for (const name of names) {
  const result = await checkPanelFolder(join(root, 'panels', name))
  if (result.ok && result.manifest.id !== name) result.warnings.push(`folder name differs from id "${result.manifest.id}"`)
  if (result.ok && ids.has(result.manifest.id)) { result.ok = false; result.errors = ['duplicate id'] }
  if (result.ok) ids.add(result.manifest.id)
  if (!result.ok) bad++
  console.log(`${result.ok ? '✓' : '✗'} ${name}${result.ok ? '' : `\n  ${result.errors.join('\n  ')}`}${result.ok && result.warnings.length ? `\n  ${result.warnings.join('\n  ')}` : ''}`)
}
process.exit(bad ? 1 : 0)
