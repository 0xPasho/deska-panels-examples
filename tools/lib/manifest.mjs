// The checks Deska runs on a package folder, written out so you can run them
// before loading the folder (contract: deska.dev/docs/community-panels).
// Deska and the registry stay the source of truth: if they refuse something
// this file let through, they are right and this file is behind.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

export const PERMISSIONS = ['notify', 'open-url', 'clipboard-write']
export const CATEGORIES = ['productivity', 'media', 'dev', 'ambient', 'other']
export const FILE_TYPES = ['html', 'js', 'mjs', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'woff2', 'md', 'txt']
export const LIMITS = { unpackedBytes: 20 * 1024 * 1024, files: 500, hosts: 20, pathLength: 200 }

const ID = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/
const COLOR = /^#[0-9a-fA-F]{6}$/
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/
const READS_AS_DESKA = /(^|[^a-z])(deska|dex)([^a-z]|$)|(^|\s)deska/i
const TOP_LEVEL = ['schema', 'id', 'name', 'version', 'description', 'author', 'icon', 'color', 'category', 'permissions', 'network', 'sdk', 'contributes']

function text(errors, field, value, max, required = true) {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || value.trim() === '') return errors.push(`${field} is required.`)
  if ([...value].length > max) errors.push(`${field} is longer than ${max} characters.`)
  if (INVISIBLE.test(value)) errors.push(`${field} holds an invisible or control character.`)
}

function pagePath(errors, field, value, ext) {
  if (typeof value !== 'string' || value === '') return errors.push(`${field} is required.`)
  if (value.startsWith('/') || value.includes('..') || value.includes('\\')) errors.push(`${field} must be a relative path inside the package.`)
  if (ext && !ext.includes(extname(value).slice(1).toLowerCase())) errors.push(`${field} must be ${ext.map((e) => `.${e}`).join(' or ')}.`)
}

export function checkManifest(m) {
  const errors = []
  const warnings = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['panel.json must be an object.'] }
  for (const key of Object.keys(m)) if (!TOP_LEVEL.includes(key)) errors.push(`Unknown field "${key}".`)
  if (m.schema !== 1) errors.push('schema must be 1.')
  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push('id: 3 to 40 lowercase letters, digits and dashes, starting and ending with a letter or digit.')
  else if (WINDOWS_DEVICE.test(m.id) || m.id.startsWith('dev-') || m.id.startsWith('deska')) errors.push(`id "${m.id}" is reserved.`)
  text(errors, 'name', m.name, 40)
  if (typeof m.version !== 'string' || !SEMVER.test(m.version) || m.version.length > 64) errors.push('version must be semver, like 1.0.0.')
  text(errors, 'description', m.description, 140)
  text(errors, 'author', m.author, 40)
  for (const field of ['name', 'author']) {
    if (typeof m[field] === 'string' && READS_AS_DESKA.test(m[field])) errors.push(`${field} may not read as Deska's own.`)
  }
  if (m.icon !== undefined) pagePath(errors, 'icon', m.icon, ['svg', 'png', 'webp'])
  if (m.color !== undefined && !COLOR.test(m.color)) errors.push('color must be #rrggbb.')
  if (m.category !== undefined && !CATEGORIES.includes(m.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}.`)
  if (!Array.isArray(m.permissions)) errors.push('permissions must be a list (it may be empty).')
  else for (const p of m.permissions) if (!PERMISSIONS.includes(p)) errors.push(`Unknown permission "${p}".`)
  if (!Array.isArray(m.network)) errors.push('network must be a list of host names (it may be empty).')
  else {
    if (m.network.length > LIMITS.hosts) errors.push(`network lists more than ${LIMITS.hosts} hosts.`)
    for (const h of m.network) if (typeof h !== 'string' || !HOST.test(h)) errors.push(`network: "${h}" is not a bare host name (no scheme, port, path or wildcard).`)
  }
  if (m.sdk !== 1) errors.push('sdk must be 1.')
  const c = m.contributes
  if (!c || typeof c !== 'object' || !c.panel) errors.push('contributes.panel is required.')
  else {
    pagePath(errors, 'contributes.panel.entry', c.panel.entry, ['html'])
    if (c.panel.scope !== undefined && !['workspace', 'global'].includes(c.panel.scope)) errors.push('contributes.panel.scope must be workspace or global.')
    if (c.panel.size !== undefined) {
      for (const k of ['width', 'height']) {
        const v = c.panel.size[k]
        if (!Number.isInteger(v) || v < 120 || v > 4000) errors.push(`contributes.panel.size.${k} must be a whole number from 120 to 4000.`)
      }
    }
    for (const key of Object.keys(c)) if (!['panel', 'extras'].includes(key)) warnings.push(`contributes.${key} is unknown and will be ignored.`)
    if (c.extras !== undefined) {
      text(errors, 'contributes.extras.title', c.extras.title, 40)
      if (typeof c.extras.title === 'string' && READS_AS_DESKA.test(c.extras.title)) errors.push("contributes.extras.title may not read as Deska's own.")
      if (c.extras.view !== undefined) pagePath(errors, 'contributes.extras.view', c.extras.view, ['html'])
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m, warnings }
}

async function listFiles(dir, base = '') {
  const out = []
  for (const entry of await readdir(join(dir, base), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)))
    else out.push({ path: rel, special: !entry.isFile(), size: entry.isFile() ? (await stat(join(dir, rel))).size : 0 })
  }
  return out
}

/** Checks a folder the way Load a folder does: the manifest, then every file. */
export async function checkPanelFolder(dir) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(dir, 'panel.json'), 'utf8'))
  } catch (err) {
    return { ok: false, errors: [`panel.json: ${err.message}`] }
  }
  const result = checkManifest(manifest)
  if (!result.ok) return result
  const errors = []
  const files = await listFiles(dir)
  if (files.length > LIMITS.files) errors.push(`More than ${LIMITS.files} files.`)
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > LIMITS.unpackedBytes) errors.push('More than 20 MB of files.')
  for (const f of files) {
    if (f.special) errors.push(`${f.path} is not a plain file.`)
    if (f.path.length > LIMITS.pathLength) errors.push(`${f.path} is a path longer than ${LIMITS.pathLength} characters.`)
    if (f.path.startsWith('__deska/')) errors.push(`${f.path}: nothing may live under __deska/.`)
    if (!FILE_TYPES.includes(extname(f.path).slice(1).toLowerCase())) errors.push(`${f.path}: .${extname(f.path).slice(1) || '(none)'} files are not allowed.`)
    if (f.path.split('/').some((s) => /[:*?"<>|]/.test(s) || /[. ]$/.test(s) || WINDOWS_DEVICE.test(s))) errors.push(`${f.path}: a name Windows cannot write.`)
  }
  const paths = new Set(files.map((f) => f.path))
  const needed = [manifest.contributes.panel.entry, manifest.contributes.extras?.view, manifest.icon].filter(Boolean)
  for (const p of needed) if (!paths.has(p)) errors.push(`${p} is named in panel.json but is not in the folder.`)
  return errors.length ? { ok: false, errors } : { ...result, files }
}
