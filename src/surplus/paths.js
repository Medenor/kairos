// Lexical folder helpers (no filesystem access, no node:path) usable in the browser and in Node.
// POSIX-style paths only; the runner targets macOS and Linux (research D10).

// Refused roots (research D10, FR-030). Compared case-insensitively (macOS volumes usually are).
const SYSTEM_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/system', '/library', '/var', '/private', '/opt']
const VOLUMES_ROOT = '/volumes'

/** 'empty' | 'absolute' | 'relative'. A leading `~` counts as absolute (home-relative). */
export function classifyFolder(input) {
  const s = typeof input === 'string' ? input.trim() : ''
  if (s === '') return 'empty'
  if (s.startsWith('/') || s === '~' || s.startsWith('~/')) return 'absolute'
  return 'relative'
}

/** Collapse `//`, `.`, `..` and trailing slashes of an absolute path. `..` never goes above `/`. */
export function normalizePath(path) {
  const out = []
  for (const part of String(path).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

/**
 * Resolve a folder typed by the user to a normalised absolute path.
 * - empty input -> {error: 'folder_empty'}
 * - relative input needs an absolute baseFolder, else {error: 'folder_missing_base'}
 * - `~` forms need homeDir (third argument) to expand, else {error: 'folder_missing_home'}
 */
export function resolveFolder(input, baseFolder, homeDir) {
  const kind = classifyFolder(input)
  if (kind === 'empty') return { error: 'folder_empty' }
  const s = input.trim()
  if (kind === 'absolute') {
    if (s.startsWith('~')) {
      if (classifyFolder(homeDir) !== 'absolute' || homeDir.trim().startsWith('~')) return { error: 'folder_missing_home' }
      return normalizePath(`${homeDir.trim()}/${s.slice(1)}`)
    }
    return normalizePath(s)
  }
  const base = typeof baseFolder === 'string' ? baseFolder.trim() : ''
  if (!base.startsWith('/')) return { error: 'folder_missing_base' }
  return normalizePath(`${base}/${s}`)
}

/**
 * Why a resolved absolute path is refused, or null when allowed:
 * 'not_absolute' | 'root' | 'home' | 'home_ancestor' | 'system' | 'volumes_root'.
 * Fails closed on anything that is not an absolute path.
 */
export function refusedLocationReason(path, homeDir) {
  if (typeof path !== 'string' || !path.trim().startsWith('/')) return 'not_absolute'
  const p = normalizePath(path).toLowerCase()
  if (p === '/') return 'root'
  if (typeof homeDir === 'string' && homeDir.trim().startsWith('/')) {
    const home = normalizePath(homeDir).toLowerCase()
    if (p === home) return 'home'
    if (home !== '/' && home.startsWith(`${p}/`)) return 'home_ancestor'
  }
  if (SYSTEM_ROOTS.some((root) => p === root || p.startsWith(`${root}/`))) return 'system'
  if (p === VOLUMES_ROOT) return 'volumes_root'
  return null
}

/** True when the folder must not be copied or run in (FR-030). */
export function isRefusedLocation(path, homeDir) {
  return refusedLocationReason(path, homeDir) !== null
}
