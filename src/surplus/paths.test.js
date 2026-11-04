import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFolder, normalizePath, resolveFolder, isRefusedLocation, refusedLocationReason } from './paths.js'

const HOME = '/home/test'

test('classifyFolder', () => {
  assert.equal(classifyFolder(''), 'empty')
  assert.equal(classifyFolder('   '), 'empty')
  assert.equal(classifyFolder(null), 'empty')
  assert.equal(classifyFolder(undefined), 'empty')
  assert.equal(classifyFolder('/Users/me/app'), 'absolute')
  assert.equal(classifyFolder('  /tmp/x '), 'absolute')
  assert.equal(classifyFolder('~/code'), 'absolute')
  assert.equal(classifyFolder('~'), 'absolute')
  assert.equal(classifyFolder('kairos'), 'relative')
  assert.equal(classifyFolder('./kairos'), 'relative')
  assert.equal(classifyFolder('../kairos'), 'relative')
  assert.equal(classifyFolder('~other/x'), 'relative')
})

test('normalizePath', () => {
  assert.equal(normalizePath('/a//b/./c/'), '/a/b/c')
  assert.equal(normalizePath('/a/b/../c'), '/a/c')
  assert.equal(normalizePath('/../..'), '/')
  assert.equal(normalizePath('/'), '/')
})

test('resolveFolder keeps absolute paths (normalised)', () => {
  assert.equal(resolveFolder('/Users/me/app/', null), '/Users/me/app')
  assert.equal(resolveFolder('/Users/me/./app/../lib', '/ignored'), '/Users/me/lib')
})

test('resolveFolder resolves relative paths against the base folder', () => {
  assert.equal(resolveFolder('kairos', '/Users/me/projects'), '/Users/me/projects/kairos')
  assert.equal(resolveFolder('./a/b', '/Users/me/projects/'), '/Users/me/projects/a/b')
  assert.equal(resolveFolder('../x', '/Users/me/projects'), '/Users/me/x')
})

test('resolveFolder reports a missing base for relative paths', () => {
  assert.deepEqual(resolveFolder('kairos', null), { error: 'folder_missing_base' })
  assert.deepEqual(resolveFolder('kairos', ''), { error: 'folder_missing_base' })
  assert.deepEqual(resolveFolder('kairos', 'relative/base'), { error: 'folder_missing_base' })
})

test('resolveFolder handles empty input and home expansion', () => {
  assert.deepEqual(resolveFolder('', '/b'), { error: 'folder_empty' })
  assert.equal(resolveFolder('~/code', null, HOME), '/home/test/code')
  assert.equal(resolveFolder('~', null, HOME), HOME)
  assert.deepEqual(resolveFolder('~/code', null), { error: 'folder_missing_home' })
})

test('isRefusedLocation refuses root, home, system locations (FR-030)', () => {
  for (const p of ['/', HOME, `${HOME}/`, '/etc', '/etc/ssh', '/usr/local', '/bin', '/sbin', '/System/Library', '/Library',
    '/var/log', '/private/tmp', '/opt/homebrew', '/Volumes', '/home', '/..']) {
    assert.equal(isRefusedLocation(p, HOME), true, p)
  }
})

test('isRefusedLocation allows project folders', () => {
  for (const p of [`${HOME}/projects/kairos`, `${HOME}/Library`, '/Volumes/Data/projects', '/srv/app', '/Users/other/code', '/usr2']) {
    assert.equal(isRefusedLocation(p, HOME), false, p)
  }
})

test('isRefusedLocation normalises before checking and ignores case', () => {
  assert.equal(isRefusedLocation(`${HOME}/projects/..`, HOME), true)
  assert.equal(isRefusedLocation('/tmp/../etc', HOME), true)
  assert.equal(isRefusedLocation('/ETC', HOME), true)
  assert.equal(isRefusedLocation(HOME.toUpperCase(), HOME), true)
})

test('isRefusedLocation fails closed on non-absolute input', () => {
  assert.equal(isRefusedLocation('relative/dir', HOME), true)
  assert.equal(isRefusedLocation('', HOME), true)
  assert.equal(isRefusedLocation(null, HOME), true)
})

test('refusedLocationReason explains why', () => {
  assert.equal(refusedLocationReason('/', HOME), 'root')
  assert.equal(refusedLocationReason(HOME, HOME), 'home')
  assert.equal(refusedLocationReason('/home', HOME), 'home_ancestor')
  assert.equal(refusedLocationReason('/etc', HOME), 'system')
  assert.equal(refusedLocationReason('/Volumes', HOME), 'volumes_root')
  assert.equal(refusedLocationReason('x', HOME), 'not_absolute')
  assert.equal(refusedLocationReason(`${HOME}/p`, HOME), null)
})
