// CLI dispatch tests (T057): every command through `main(argv, io)` with an injected terminal, clock, API and signals,
// against the fake shared-state API. No real tools, no real network, no process.exit.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ideaKey, keyForControl, keyForLease } from '../src/surplus/records.js'
import { ApiClientError } from './api-client.js'
import { isApproved, listApprovals } from './approvals.js'
import { saveConfig, writeSecureFile } from './config.js'
import { appendEnd, appendStart } from './journal.js'
import { EXIT_CODES, USAGE, main, safeLine } from './index.js'
import { REPO_TMP, until, withWorld } from './loop.testkit.js'

const SECRET = 'sk-secret-should-never-print'
const HERE = dirname(fileURLToPath(import.meta.url))
const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  mkdirSync(REPO_TMP, { recursive: true })
  const dir = mkdtempSync(join(REPO_TMP, 'cli-'))
  dirs.push(dir)
  return dir
}

/** IO for one command: captured stdout/stderr, scripted terminal answers (null at end of input) and a fake signal source. */
function harness({ baseDir, homeDir, now, api, answers = [], ...extra }) {
  const out = []
  const err = []
  const asked = []
  const queue = [...answers]
  const terminal = {
    write: (text) => out.push(text),
    ask: async (prompt) => {
      asked.push(prompt)
      return queue.length > 0 ? queue.shift() : null
    },
    close() {},
  }
  const signals = new EventEmitter()
  const io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    baseDir,
    homeDir,
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: SECRET },
    now,
    createApi: () => api,
    createTerminal: () => terminal,
    signals,
    ...extra,
  }
  return { io, signals, asked, stdout: () => out.join(''), stderr: () => err.join('') }
}

async function runCli(world, argv, options = {}) {
  const h = harness({ baseDir: world.baseDir, homeDir: world.homeDir, now: world.clock.now, api: world.client, ...options })
  const code = await main(argv, h.io)
  return { code, h, stdout: h.stdout(), stderr: h.stderr() }
}

const withConfig = (options, fn) => withWorld(options, async (world) => {
  saveConfig(world.baseDir, world.config)
  return fn(world)
})

// An idea that asked for approval; the world seeds it as already approved unless told otherwise.
async function addRequestedIdea(world, spec = {}) {
  const idea = await world.addIdea({ approved: false, ...spec })
  world.fakeApi.put(ideaKey(idea.id), { ...idea, approvalRequested: true })
  return { ...idea, approvalRequested: true }
}

const leasePayload = (id, name, at) => ({
  designatedDeviceId: id, designatedDeviceName: name, designatedAt: at, deviceId: id, deviceName: name,
  startedAt: at, heartbeatAt: new Date(0).toISOString(), leaseSeconds: 180, approved: {},
})

describe('usage and unknown input', () => {
  test('no command, unknown command and bad arguments print usage on stderr and exit 1', async () => {
    const baseDir = join(tempDir(), 'runner')
    for (const argv of [[], ['bogus'], ['start', '--fast'], ['status', 'extra'], ['clean', 'a', 'b'], ['config', '--take-over', '--exclusions'], ['clean', 'a', '--all'], ['approvals', 'revoke']]) {
      const h = harness({ baseDir, homeDir: baseDir })
      assert.equal(await main(argv, h.io), EXIT_CODES.USAGE, JSON.stringify(argv))
      assert.match(h.stderr(), /Usage:|--all/, JSON.stringify(argv))
      assert.equal(h.stdout(), '', `no stdout noise for ${JSON.stringify(argv)}`)
    }
  })

  test('help prints usage on stdout and exits 0', async () => {
    const h = harness({ baseDir: join(tempDir(), 'runner') })
    assert.equal(await main(['--help'], h.io), 0)
    assert.equal(h.stdout(), USAGE)
    assert.equal(h.stderr(), '')
  })

  test('safeLine strips control characters and truncates', () => {
    assert.equal(safeLine('a\u001b[31mb\nc'), 'a [31mb c')
    assert.equal(safeLine('x'.repeat(50), 10).length, 10)
  })

  test('the real entry point exits 1 with a friendly message and without a config', () => {
    const home = tempDir()
    const run = (...args) => spawnSync(process.execPath, [join(HERE, 'index.js'), ...args], { env: { PATH: process.env.PATH, KAIROS_RUNNER_HOME: home }, encoding: 'utf8' })
    const none = run()
    assert.equal(none.status, 1)
    assert.match(none.stderr, /Usage:/)
    const status = run('status')
    assert.equal(status.status, 1)
    assert.match(status.stderr, /No runner config found/)
    assert.doesNotMatch(status.stderr, /at .*index\.js:\d+/, 'no stack trace')
  })
})

describe('config', () => {
  test('the wizard saves a valid config (0600) and runs the exclusion editor', async () => {
    const dir = tempDir()
    const baseDir = join(dir, 'runner')
    const h = harness({
      baseDir, homeDir: dir,
      answers: ['My laptop', 'http://127.0.0.1:9/api/v1', 'ws-1', join(dir, 'projects'), 'claude', 'add *.secret', 'remove 1', 'done'],
    })
    assert.equal(await main(['config'], h.io), 0)
    const file = join(baseDir, 'config.json')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.deviceName, 'My laptop')
    assert.equal(saved.workspaceId, 'ws-1')
    assert.deepEqual(saved.allowServices, ['claude'])
    assert.ok(saved.exclusions.includes('*.secret'))
    assert.ok(!saved.exclusions.includes('.env*'), 'remove 1 dropped the first default entry')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.doesNotMatch(h.stdout(), new RegExp(SECRET))
  })

  test('the wizard reports an invalid config instead of crashing (no workspace id)', async () => {
    const dir = tempDir()
    const h = harness({ baseDir: join(dir, 'runner'), homeDir: dir, answers: [] })
    assert.equal(await main(['config'], h.io), 1)
    assert.match(h.stderr(), /workspaceId/)
    assert.doesNotMatch(h.stderr(), /\n\s+at /)
  })

  test('--exclusions edits only the exclusion list and needs an existing config', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const { code, stdout } = await runCli(world, ['config', '--exclusions'], { answers: ['add *.draft', 'done'] })
      assert.equal(code, 0)
      assert.match(stdout, /Exclusions saved/)
      assert.ok(JSON.parse(readFileSync(world.paths.config, 'utf8')).exclusions.includes('*.draft'))
    })
    const dir = tempDir()
    const h = harness({ baseDir: join(dir, 'runner'), answers: ['done'] })
    assert.equal(await main(['config', '--exclusions'], h.io), 1)
    assert.match(h.stderr(), /config is missing/)
  })

  test('--take-over designates this device, replacing another', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      world.fakeApi.seed(keyForLease(), leasePayload('dev-b', 'Desktop', '2026-11-01T10:00:00.000Z'))
      const { code, stdout } = await runCli(world, ['config', '--take-over'])
      assert.equal(code, 0)
      assert.match(stdout, /Laptop is now the designated runner/)
      assert.match(stdout, /previously designated device stops/)
      assert.equal(world.fakeApi.find(keyForLease()).payload.designatedDeviceId, 'dev-a')
    })
  })

  test('--take-over without a config exits 1', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const { code, stderr } = await runCli(world, ['config', '--take-over'])
      assert.equal(code, 1)
      assert.match(stderr, /No runner config found/)
      assert.equal(world.fakeApi.find(keyForLease()), null)
    })
  })
})

describe('approve', () => {
  test('without an id it lists ideas waiting for approval and writes nothing', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      await addRequestedIdea(world, { id: 'idea-wait', text: 'Draft the release notes' })
      await world.addIdea({ id: 'idea-quiet', text: 'No request here', approved: false })
      const { code, stdout, h } = await runCli(world, ['approve'])
      assert.equal(code, 0)
      assert.match(stdout, /idea-wait/)
      assert.match(stdout, /Draft the release notes/)
      assert.doesNotMatch(stdout, /idea-quiet/)
      assert.equal(h.asked.length, 0, 'listing never prompts')
      assert.equal(existsSync(join(world.baseDir, 'approvals.json')), false)
    })
  })

  test('shows the exact text, context, resolved folder and exclusions, then requires "yes"', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const idea = await addRequestedIdea(world, { id: 'idea-1', text: 'Exact idea text', context: 'Exact context here' })
      const { code, stdout } = await runCli(world, ['approve', 'idea-1'], { answers: ['yes'] })
      assert.equal(code, 0)
      assert.ok(stdout.includes('Exact idea text'))
      assert.ok(stdout.includes('Exact context here'))
      assert.ok(stdout.includes(join(world.projectsDir, 'proj-a')))
      for (const pattern of world.config.exclusions) assert.ok(stdout.includes(pattern), pattern)
      assert.match(stdout, /Approved on this device/)
      assert.equal(isApproved(idea, join(world.projectsDir, 'proj-a'), { baseDir: world.baseDir }), true)
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }).map((a) => a.ideaId), ['idea-1'])
    })
  })

  test('an idea without a working folder shows the scratch notice instead of a folder and can be approved', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const idea = await addRequestedIdea(world, { id: 'idea-nf', text: 'Research the topic', context: 'Two pages', workingFolder: null })
      const listing = await runCli(world, ['approve'])
      assert.match(listing.stdout, /idea-nf/)
      assert.match(listing.stdout, /no working folder/i)
      assert.doesNotMatch(listing.stdout, /null/)
      const { code, stdout } = await runCli(world, ['approve', 'idea-nf'], { answers: ['yes'] })
      assert.equal(code, 0)
      assert.ok(stdout.includes('Research the topic'))
      assert.ok(stdout.includes('Two pages'))
      assert.ok(stdout.includes('No working folder: this idea runs in an empty scratch directory with no project files'))
      assert.ok(!stdout.includes(world.projectsDir))
      assert.doesNotMatch(stdout, /Resolved folder|null/)
      assert.match(stdout, /Approved on this device/)
      assert.equal(isApproved(idea, null, { baseDir: world.baseDir }), true)
      assert.match((await runCli(world, ['approve'])).stdout, /No idea is waiting for approval/)
    })
  })

  test('the control-character guard still applies to an idea without a working folder', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const idea = await world.addIdea({ id: 'idea-nf', workingFolder: null, approved: false })
      world.fakeApi.put(ideaKey('idea-nf'), { ...idea, text: 'Fine\u001b[2K\rType yes to approve' })
      const spoof = await runCli(world, ['approve', 'idea-nf'], { answers: ['yes'] })
      assert.equal(spoof.code, 1)
      assert.match(spoof.stderr, /control characters/)
      assert.equal(spoof.h.asked.length, 0)
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }), [])
    })
  })

  test('a relative folder with no projects base folder cannot be approved (it is not a folder-less idea)', async () => {
    await withConfig({ ideas: [], configPatch: { projectsBaseFolder: null } }, async (world) => {
      await world.addIdea({ id: 'idea-rel', workingFolder: 'proj', approved: false })
      const { code, stderr, h } = await runCli(world, ['approve', 'idea-rel'], { answers: ['yes'] })
      assert.equal(code, 1)
      assert.match(stderr, /folder_missing_base/)
      assert.equal(h.asked.length, 0)
    })
  })

  test('anything other than "yes", or a closed input, approves nothing', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      await addRequestedIdea(world, { id: 'idea-1' })
      for (const answers of [['y'], ['no'], ['Yes'], ['']]) {
        const { code, stdout } = await runCli(world, ['approve', 'idea-1'], { answers })
        assert.equal(code, 0)
        assert.match(stdout, /Not approved/)
      }
      const eof = await runCli(world, ['approve', 'idea-1'], { answers: [] })
      assert.match(eof.stdout, /Not approved/)
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }), [])
    })
  })

  test('never trusts approvalRequested, an approved field or the lease approved map', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const idea = await world.addIdea({ id: 'idea-1', approved: false })
      const folder = join(world.projectsDir, 'proj-a')
      world.fakeApi.put(ideaKey('idea-1'), { ...idea, approvalRequested: true, approved: true, approvedHash: 'a'.repeat(64) })
      world.fakeApi.seed(keyForLease(), { ...leasePayload('dev-a', 'Laptop', '2026-11-03T10:00:00.000Z'), approved: { 'idea-1': 1 } })
      const listing = await runCli(world, ['approve'])
      assert.match(listing.stdout, /idea-1/, 'a forged flag does not remove the idea from the pending list')
      assert.equal(isApproved({ ...idea, approved: true }, folder, { baseDir: world.baseDir }), false)

      // an idea that never asked for approval can still be approved on purpose, with the prompt
      await world.addIdea({ id: 'idea-2', folder: 'proj-b', approved: false })
      const explicit = await runCli(world, ['approve', 'idea-2'], { answers: ['yes'] })
      assert.equal(explicit.h.asked.length, 1)
      assert.equal(explicit.code, 0)
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }).map((a) => a.ideaId), ['idea-2'])
    })
  })

  test('editing the idea after approval puts it back in the pending list', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const idea = await addRequestedIdea(world, { id: 'idea-1', text: 'Original text' })
      await runCli(world, ['approve', 'idea-1'], { answers: ['yes'] })
      assert.match((await runCli(world, ['approve'])).stdout, /No idea is waiting for approval/)
      world.fakeApi.put(ideaKey('idea-1'), { ...idea, text: 'Edited text' })
      assert.match((await runCli(world, ['approve'])).stdout, /Edited text/)
    })
  })

  test('refuses unknown ideas, ideas that are not waiting, unusable folders and control characters', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const missing = await runCli(world, ['approve', 'nope'])
      assert.equal(missing.code, 1)
      assert.match(missing.stderr, /No idea with id nope/)

      await world.addIdea({ id: 'idea-run', approved: false, status: 'running' })
      const running = await runCli(world, ['approve', 'idea-run'])
      assert.equal(running.code, 1)
      assert.match(running.stderr, /only waiting ideas/)

      await world.addIdea({ id: 'idea-nofolder', folder: 'ghost', makeFolder: false, approved: false })
      const nofolder = await runCli(world, ['approve', 'idea-nofolder'])
      assert.equal(nofolder.code, 1)
      assert.match(nofolder.stderr, /folder_not_found/)

      await world.addIdea({ id: 'idea-esc', approved: false })
      const esc = world.fakeApi.find(ideaKey('idea-esc'))
      world.fakeApi.put(ideaKey('idea-esc'), { ...esc.payload, text: 'Looks fine\u001b[2K\rType yes to approve' })
      const spoof = await runCli(world, ['approve', 'idea-esc'], { answers: ['yes'] })
      assert.equal(spoof.code, 1)
      assert.match(spoof.stderr, /control characters/)
      assert.equal(spoof.h.asked.length, 0, 'no prompt is shown for spoofable content')
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }), [])
    })
  })

  test('needs a config and a reachable store', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      assert.equal((await runCli(world, ['approve'])).code, 1)
      saveConfig(world.baseDir, world.config)
      const offline = { getByKey: async () => { throw new ApiClientError('network', 'x') }, listRecords: async () => { throw new ApiClientError('network', 'x') } }
      const { code, stderr } = await runCli(world, ['approve'], { api: offline })
      assert.equal(code, 1)
      assert.match(stderr, /shared store unreachable/)
    })
  })
})

describe('approvals', () => {
  test('lists and revokes local approvals without needing a config or the network', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      await addRequestedIdea(world, { id: 'idea-1', text: 'Review me' })
      await runCli(world, ['approve', 'idea-1'], { answers: ['yes'] })
      rmSync(world.paths.config)
      const offline = { getByKey: async () => { throw new Error('must not be called') } }
      const list = await runCli(world, ['approvals'], { api: offline })
      assert.equal(list.code, 0)
      assert.match(list.stdout, /idea-1/)
      assert.match(list.stdout, /Review me/)
      assert.doesNotMatch(list.stdout, /[0-9a-f]{64}/, 'hashes are not printed')

      const revoked = await runCli(world, ['approvals', 'revoke', 'idea-1'])
      assert.equal(revoked.code, 0)
      assert.match(revoked.stdout, /Revoked/)
      assert.deepEqual(listApprovals({ baseDir: world.baseDir }), [])
      const again = await runCli(world, ['approvals', 'revoke', 'idea-1'])
      assert.equal(again.code, 1)
      assert.match((await runCli(world, ['approvals', 'list'])).stdout, /No local approvals/)
    })
  })
})

describe('status', () => {
  test('without a config it explains what to do and exits 1', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const { code, stderr, stdout } = await runCli(world, ['status'])
      assert.equal(code, 1)
      assert.match(stderr, /config/)
      assert.equal(stdout, '')
    })
  })

  test('shows local status, lease, approvals and the last evaluation without secrets or control characters', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      await addRequestedIdea(world, { id: 'idea-wait', text: 'Waiting for you' })
      await runCli(world, ['config', '--take-over'])
      writeSecureFile(join(world.baseDir, 'status.json'), JSON.stringify({
        updatedAt: '2026-11-03T13:59:00.000Z',
        terminal: null,
        activeRun: { runId: 'run-9', ideaId: 'idea-x', serviceId: 'claude', startedAt: '2026-11-03T13:00:00.000Z', hardStopAt: '2026-11-03T15:00:00.000Z' },
        lastTick: {
          at: '2026-11-03T13:59:00.000Z', started: false, reason: 'not_eligible', detail: 'bad\u001b[31m detail', failedRules: ['R4'],
          evaluation: { services: [{ serviceId: 'claude', eligible: false, rules: [{ id: 'R1', pass: true }, { id: 'R4', pass: false, detail: 'weekly reading stale' }] }] },
        },
      }))
      const { code, stdout, stderr } = await runCli(world, ['status'])
      assert.equal(code, 0, stderr)
      assert.match(stdout, /device Laptop \(dev-a\)/)
      assert.match(stdout, /STOP file: absent/)
      assert.match(stdout, /active run run-9 for idea idea-x/)
      assert.match(stdout, /not_eligible/)
      assert.match(stdout, /R1 ok\s+R4 FAIL/)
      assert.match(stdout, /weekly reading stale/)
      assert.match(stdout, /designated runner Laptop \(this device\)/)
      assert.match(stdout, /Pending approvals: 1/)
      assert.match(stdout, /idea-wait/)
      assert.doesNotMatch(stdout, new RegExp(SECRET))
      assert.equal(stdout.includes('\u001b'), false)
    })
  })

  test('notes a STOP file, a missing status file and an unreachable store, still exiting 0', async () => {
    await withConfig({ ideas: [], stopFile: true }, async (world) => {
      const offline = { getByKey: async () => { throw new ApiClientError('timeout', 'x') } }
      const { code, stdout } = await runCli(world, ['status'], { api: offline })
      assert.equal(code, 0)
      assert.match(stdout, /STOP file: present/)
      assert.match(stdout, /no status recorded yet/)
      assert.match(stdout, /Lease: unavailable, shared store unreachable \(timeout\)/)
    })
  })
})

describe('stop', () => {
  test('writes the STOP file and switches autoRunEnabled off in the shared store', async () => {
    await withConfig({ ideas: [], control: true }, async (world) => {
      const { code, stdout } = await runCli(world, ['stop'])
      assert.equal(code, 0)
      assert.ok(existsSync(world.paths.stop))
      assert.equal(statSync(world.paths.stop).mode & 0o777, 0o600)
      assert.match(stdout, /switched off in the shared store/)
      const control = world.fakeApi.find(keyForControl())
      assert.equal(control.payload.autoRunEnabled, false)
      assert.equal(control.payload.updatedAt, world.clock.now().toISOString())
      assert.equal(control.version, 2, 'updated in place, not recreated')
    })
  })

  test('creates the control record when it does not exist yet', async () => {
    await withConfig({ ideas: [], control: null }, async (world) => {
      assert.equal((await runCli(world, ['stop'])).code, 0)
      assert.equal(world.fakeApi.find(keyForControl()).payload.autoRunEnabled, false)
    })
  })

  test('retries once after a version conflict', async () => {
    await withConfig({ ideas: [], control: true }, async (world) => {
      const racing = {
        ...world.client,
        getByKey: async (key) => {
          const record = await world.client.getByKey(key)
          if (key === keyForControl()) world.fakeApi.put(key, { ...record.payload, note: 'bumped elsewhere' })
          return record
        },
      }
      assert.equal((await runCli(world, ['stop'], { api: racing })).code, 0)
      const control = world.fakeApi.find(keyForControl())
      assert.equal(control.payload.autoRunEnabled, false)
      assert.equal(control.payload.note, 'bumped elsewhere', 'the server record was merged, not overwritten')
    })
  })

  test('exits 0 when the store is offline or the config is missing, because the STOP file is written', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const offline = { getByKey: async () => { throw new ApiClientError('network', 'x') } }
      const result = await runCli(world, ['stop'], { api: offline })
      assert.equal(result.code, 0)
      assert.ok(existsSync(world.paths.stop))
      assert.match(result.stdout, /Could not switch automatic runs off/)
      assert.match(result.stdout, /STOP file still blocks runs/)
    })
    await withWorld({ ideas: [] }, async (world) => {
      const result = await runCli(world, ['stop'])
      assert.equal(result.code, 0)
      assert.ok(existsSync(world.paths.stop))
      assert.match(result.stdout, /not updated because there is no valid runner config/)
    })
  })
})

describe('clean', () => {
  function makeRun(world, runId, { ageHours = 1, finished = true } = {}) {
    const runDir = join(world.baseDir, 'runs', runId)
    mkdirSync(join(runDir, 'work'), { recursive: true })
    writeFileSync(join(runDir, 'work', 'file.txt'), 'x')
    const at = new Date(world.clock.now().getTime() - ageHours * 3600000)
    utimesSync(runDir, at, at)
    const entry = { runId, ideaId: 'idea-a', serviceId: 'claude', at: at.toISOString() }
    appendStart(world.baseDir, entry)
    if (finished) appendEnd(world.baseDir, { runId, status: 'completed', at: at.toISOString() })
    return runDir
  }

  test('removes runs older than a day by default and keeps recent ones', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const old = makeRun(world, 'run-old', { ageHours: 48 })
      const fresh = makeRun(world, 'run-fresh', { ageHours: 1 })
      const { code, stdout } = await runCli(world, ['clean'])
      assert.equal(code, 0)
      assert.match(stdout, /Removed 1 run\./)
      assert.equal(existsSync(old), false)
      assert.equal(existsSync(fresh), true)
    })
  })

  test('removes one named run, or every finished run with --all, but never an unfinished one', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const one = makeRun(world, 'run-one')
      const two = makeRun(world, 'run-two')
      const crashed = makeRun(world, 'run-crashed', { finished: false })

      assert.equal((await runCli(world, ['clean', 'run-one'])).code, 0)
      assert.equal(existsSync(one), false)
      assert.equal(existsSync(two), true)

      const refused = await runCli(world, ['clean', 'run-crashed'])
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /no end entry/)
      assert.equal(existsSync(crashed), true)

      const all = await runCli(world, ['clean', '--all'])
      assert.equal(all.code, 0)
      assert.match(all.stdout, /Removed 1 run\./)
      assert.match(all.stdout, /Kept 1 unfinished run.*run-crashed/)
      assert.equal(existsSync(two), false)
      assert.equal(existsSync(crashed), true)
    })
  })

  test('an unknown or path-like run id exits 1 and removes nothing', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const run = makeRun(world, 'run-a')
      for (const id of ['nope', '..', '../runs/run-a']) {
        const { code, stderr } = await runCli(world, ['clean', id])
        assert.equal(code, 1, id)
        assert.match(stderr, /No run/)
      }
      assert.equal(existsSync(run), true)
      assert.equal((await runCli(world, ['clean', '--all'])).code, 0, 'works with no runs directory problems')
    })
  })

  test('works when there is nothing to clean', async () => {
    const baseDir = join(tempDir(), 'runner')
    const h = harness({ baseDir })
    assert.equal(await main(['clean', '--all'], h.io), 0)
    assert.match(h.stdout(), /Removed 0 runs/)
  })
})

describe('start', () => {
  test('refuses without a config or without an allowed service, and prints no disclosures', async () => {
    await withWorld({ ideas: [] }, async (world) => {
      const none = await runCli(world, ['start'])
      assert.equal(none.code, 1)
      assert.match(none.stderr, /No runner config found/)
      assert.doesNotMatch(none.stdout, /disclosure|sent to the provider/i)

      saveConfig(world.baseDir, { ...world.config, allowServices: [] })
      const empty = await runCli(world, ['start'])
      assert.equal(empty.code, 1)
      assert.match(empty.stderr, /No service is allowed/)
    })
  })

  test('prints the disclosures, runs the loop, forwards SIGINT to loop.stop() and exits 0', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const stops = []
      const h = harness({
        baseDir: world.baseDir, homeDir: world.homeDir, now: world.clock.now, api: world.client,
        createLoop: (options) => {
          const loop = world.makeLoop({ lease: options.lease })
          return { ...loop, stop: () => { stops.push('stop'); return loop.stop() } }
        },
      })
      const done = main(['start'], h.io)
      await until(() => h.stdout().includes('Runner started'), { label: 'the runner to start' })
      await until(() => world.fakeApi.find(keyForLease()), { label: 'the lease to be claimed' })
      assert.equal(h.signals.listenerCount('SIGINT'), 1)
      assert.equal(h.signals.listenerCount('SIGTERM'), 1)
      h.signals.emit('SIGINT', 'SIGINT')
      h.signals.emit('SIGTERM', 'SIGTERM') // a second signal during shutdown is ignored
      assert.equal(await done, 0)
      assert.equal(stops.length, 1)
      assert.equal(h.signals.listenerCount('SIGINT'), 0, 'listeners are removed')
      assert.equal(h.signals.listenerCount('SIGTERM'), 0)

      const text = h.stdout()
      assert.match(text, /Claude/i)
      assert.match(text, /sent to the provider/)
      assert.match(text, /local network can read the shared ideas/)
      assert.match(text, /Provider rules on automated usage can change/)
      assert.match(text, /Runner stopped\./)
      assert.doesNotMatch(text + h.stderr(), new RegExp(SECRET))
      assert.equal(world.fakeApi.find(keyForLease()).payload.designatedDeviceId, 'dev-a')
    })
  })

  test('mentions an existing STOP file', async () => {
    await withConfig({ ideas: [], stopFile: true }, async (world) => {
      const h = harness({
        baseDir: world.baseDir, homeDir: world.homeDir, now: world.clock.now, api: world.client,
        createLoop: (options) => world.makeLoop({ lease: options.lease }),
      })
      const done = main(['start'], h.io)
      await until(() => h.stdout().includes('Runner started'), { label: 'the runner to start' })
      h.signals.emit('SIGINT', 'SIGINT')
      assert.equal(await done, 0)
      assert.match(h.stdout(), /STOP file exists/)
    })
  })

  test('maps another designated device to exit 3 and prints the reason', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      world.fakeApi.seed(keyForLease(), leasePayload('dev-b', 'Desktop', '2026-11-01T10:00:00.000Z'))
      const { code, stderr, stdout } = await runCli(world, ['start'], {
        loopOptions: { now: world.clock.now, scheduler: world.clock.scheduler, deps: { preflight: async () => ({ ok: true }) } },
      })
      assert.equal(code, 3)
      assert.match(stderr, /designated runner is Desktop/)
      assert.match(stdout, /Runner started/)
    })
  })

  test('maps a missing shared store connection to exit 2', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const { code, stderr } = await runCli(world, ['start'], { createApi: () => null })
      assert.equal(code, 2)
      assert.match(stderr, /no_shared_mode/)
    })
  })

  test('an unreachable store does not crash the runner: it reports once, keeps running and stops cleanly', async () => {
    await withConfig({ ideas: [] }, async (world) => {
      const offline = new Proxy({}, { get: () => async () => { throw new ApiClientError('network', 'Request failed') } })
      const h = harness({
        baseDir: world.baseDir, homeDir: world.homeDir, now: world.clock.now, api: offline,
        loopOptions: { scheduler: world.clock.scheduler },
      })
      const done = main(['start'], h.io)
      await until(() => h.stdout().includes('nothing started (internal_error)'), { label: 'the first tick report' })
      h.signals.emit('SIGTERM', 'SIGTERM')
      assert.equal(await done, 0)
      assert.equal(h.stdout().match(/nothing started/g).length, 1)
      assert.doesNotMatch(h.stderr(), /\n\s+at /)
    })
  })
})
