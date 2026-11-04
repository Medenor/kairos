// T072: edge cases of the spec at the runner level: ideas without a working folder, invalid shared ideas,
// approvals withdrawn by each content edit, and very large multi-byte output.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ideaKey, validateRunRecord } from '../src/surplus/records.js'
import { claudeResult, withWorld } from './loop.testkit.js'

const tools = (name) => (w) => w.cli[name].calls().filter((c) => !c.argv.includes('--help') && c.argv[0] !== 'auth')

// FR-017: an idea without a working folder is limited to drafts that need no project files. It runs in an empty
// scratch directory under <baseDir>/runs/{runId}/work, is approved on the runner with resolvedFolder null, and
// never touches the user's disk.
test('an approved idea with no working folder runs in an empty scratch directory and its files become the proposal', () =>
  withWorld({
    ideas: [{ id: 'no-folder', workingFolder: null }],
    cli: { claude: { writeFiles: { 'draft.md': 'A draft\n' } } },
  }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, true, JSON.stringify([result.reason, result.detail]))
    assert.equal(result.run.status, 'completed')
    const [call] = tools('claude')(w)
    assert.equal(call.cwd, join(w.baseDir, 'runs', 'run-1', 'work'), 'the tool ran in the scratch directory')
    assert.match(call.argv.join(' '), /no project files/i)
    const run = w.run('run-1')
    assert.equal(validateRunRecord(run).valid, true)
    assert.equal(run.ideaSnapshot.workingFolder, null)
    assert.equal(run.ideaSnapshot.resolvedFolder, null)
    assert.equal(run.proposal.files, 1)
    assert.match(run.proposal.diff, /--- \/dev\/null\n\+\+\+ b\/draft\.md\n/)
    assert.match(run.proposal.diff, /\+A draft/)
    assert.equal(w.idea('no-folder').payload.status, 'completed')
    assert.deepEqual(readdirSync(w.projectsDir), [], 'nothing from or into the projects folder')
  }))

test('an idea with no working folder that is not approved never runs', () =>
  withWorld({ ideas: [{ id: 'no-folder', workingFolder: null, approved: false }] }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'not_approved')
    assert.equal(w.runs().length, 0)
    assert.equal(tools('claude')(w).length, 0)
    assert.equal(existsSync(join(w.baseDir, 'runs')), false, 'no scratch directory is created')
  }))

test('the approval of a folder-less idea does not carry over once it gains a folder', () =>
  withWorld({ ideas: [{ id: 'no-folder', workingFolder: null }] }, async (w) => {
    mkdirSync(join(w.projectsDir, 'proj-a'), { recursive: true })
    writeFileSync(join(w.projectsDir, 'proj-a', 'README.md'), 'hello\n')
    w.putRouting(ideaKey('no-folder'), { ...w.idea('no-folder').payload, workingFolder: 'proj-a', contentVersion: 2 })
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'not_approved')
    assert.equal(tools('claude')(w).length, 0)
  }))

test('a relative folder with no base folder is an error, not a folder-less run', () =>
  withWorld({ ideas: [{ id: 'rel', workingFolder: 'proj', makeFolder: false, approved: false }], configPatch: { projectsBaseFolder: null } }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'folder_missing_base')
    assert.equal(tools('claude')(w).length, 0)
  }))

test('two folder-less ideas do not block each other: each run has its own scratch directory', () =>
  withWorld({ ideas: [{ id: 'a', workingFolder: null }, { id: 'b', workingFolder: null }] }, async (w) => {
    const loop = w.makeLoop()
    const first = await loop.tick()
    assert.equal(first.started, true)
    const second = await loop.tick()
    assert.equal(second.started, true, JSON.stringify([second.reason, second.detail]))
    assert.notEqual(first.run.id, second.run.id)
    const cwds = tools('claude')(w).map((c) => c.cwd)
    assert.equal(new Set(cwds).size, 2)
  }))

test('an invalid shared idea is never run, and a valid approved idea next to it still is', () =>
  withWorld({ ideas: [{ id: 'bad', priority: 'high' }, { id: 'good' }] }, async (w) => {
    const bad = w.idea('bad')
    w.putRouting(ideaKey('bad'), { ...bad.payload, size: 'gigantic', text: '' })
    const result = await w.makeLoop().tick()
    assert.equal(result.started, true)
    assert.equal(result.run.ideaId, 'good')
    assert.equal(w.runs().length, 1)
    assert.equal(w.idea('bad').payload.status, 'waiting')
  }))

test('only invalid shared ideas: nothing runs and the tool is never started', () =>
  withWorld({ ideas: [{ id: 'bad' }] }, async (w) => {
    w.putRouting(ideaKey('bad'), { ...w.idea('bad').payload, status: 'hacked' })
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(w.runs().length, 0)
    assert.equal(tools('claude')(w).length, 0)
  }))

for (const [name, change, setup] of [
  ['context', { context: 'Now also touch the config' }, null],
  ['working folder', { workingFolder: 'proj-b' }, (w) => {
    mkdirSync(join(w.projectsDir, 'proj-b'), { recursive: true })
    writeFileSync(join(w.projectsDir, 'proj-b', 'README.md'), 'other\n')
  }],
]) {
  test(`editing only the ${name} after approval withdraws it: no run until approved again`, () =>
    withWorld({}, async (w) => {
      setup?.(w)
      w.putRouting(ideaKey('idea-a'), { ...w.idea().payload, ...change, contentVersion: 2 })
      const first = w.makeLoop()
      const result = await first.tick()
      assert.equal(result.started, false)
      assert.equal(result.reason, 'not_approved')
      assert.equal(w.runs().length, 0)
      await first.stop()

      // Approving the new content on the runner device makes it runnable.
      await w.approveIdea(w.idea().payload)
      const again = await w.makeLoop().tick()
      assert.equal(again.started, true, JSON.stringify([again.reason, again.detail]))
    }))
}

test('a flag, version bump or approval-looking fields planted in the shared store never authorise a run', () =>
  withWorld({ ideas: [{ id: 'idea-a', approved: false }] }, async (w) => {
    w.putRouting(ideaKey('idea-a'), { ...w.idea().payload, approvalRequested: true, approved: true, approvedHash: 'x'.repeat(64), contentVersion: 5 })
    const result = await w.makeLoop().tick()
    assert.equal(result.started, false)
    assert.equal(result.reason, 'not_approved')
    assert.equal(tools('claude')(w).length, 0)
  }))

test('multi-byte output over 256 KB is cut on a character boundary and the run record stays valid', () =>
  withWorld({ cli: { claude: { stdout: claudeResult('€'.repeat(200000)) } } }, async (w) => {
    const result = await w.makeLoop().tick()
    assert.equal(result.run.status, 'completed')
    const run = w.run('run-1')
    assert.equal(run.truncated, true)
    assert.ok(Buffer.byteLength(run.output) <= 256 * 1024)
    assert.ok(Buffer.byteLength(run.output) > 256 * 1024 - 4)
    assert.ok(!run.output.includes('�'))
    assert.equal(run.output, '€'.repeat(run.output.length))
    assert.equal(validateRunRecord(run).valid, true)
  }))
