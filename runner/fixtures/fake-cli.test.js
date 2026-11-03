import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFakeCli } from './fake-cli.js'

const TMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.test-tmp')
const created = []
function tempDir() {
  mkdirSync(TMP_ROOT, { recursive: true })
  const dir = mkdtempSync(join(TMP_ROOT, 'fakecli-'))
  created.push(dir)
  return dir
}
test.after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const run = (tool, args, options = {}) => spawnSync(tool.path, args, { encoding: 'utf8', ...options })

test('prints configured output, exits with the configured code and records cwd, argv and env', () => {
  const dir = tempDir()
  const work = join(dir, 'work')
  mkdirSync(work)
  const tool = writeFakeCli(dir, 'claude', { stdout: 'hello\n', stderr: 'warn\n', exitCode: 3 })
  const result = run(tool, ['-p', 'do it', '--flag'], { cwd: work, env: { PATH: process.env.PATH, ONLY_THIS: '1', FAKE_CLI_X: 'hidden' } })
  assert.equal(result.status, 3)
  assert.equal(result.stdout, 'hello\n')
  assert.equal(result.stderr, 'warn\n')
  const [call] = tool.calls()
  assert.deepEqual(call.argv, ['-p', 'do it', '--flag'])
  assert.equal(call.cwd, work)
  assert.equal(call.env.ONLY_THIS, '1')
  assert.equal(call.env.FAKE_CLI_X, undefined)
})

test('answers --help and --version without running', () => {
  const tool = writeFakeCli(tempDir(), 'codex', { helpText: '--sandbox --cd\n', stdout: 'run output' })
  assert.equal(run(tool, ['exec', '--help']).stdout, '--sandbox --cd\n')
  assert.match(run(tool, ['--version']).stdout, /fake-cli/)
})

test('auth status modes for the claude style', () => {
  const tool = writeFakeCli(tempDir(), 'claude', {})
  const status = (mode) => {
    tool.setBehavior({ auth: { mode } })
    return run(tool, ['auth', 'status', '--json'])
  }
  assert.equal(JSON.parse(status('subscription').stdout).authMethod, 'claude.ai')
  assert.equal(JSON.parse(status('api_key').stdout).authMethod, 'api_key')
  assert.throws(() => JSON.parse(status('unparseable').stdout))
  assert.equal(JSON.parse(status('logged_out').stdout).loggedIn, false)
  assert.equal(status('fail').status, 1)
})

test('login status modes for the codex style', () => {
  const tool = writeFakeCli(tempDir(), 'codex', {})
  const status = (mode) => {
    tool.setBehavior({ auth: { mode } })
    return run(tool, ['login', 'status'])
  }
  assert.match(status('subscription').stdout, /Logged in using ChatGPT/)
  assert.match(status('api_key').stdout, /Logged in using an API key/)
  assert.doesNotMatch(status('unparseable').stdout, /Logged in/)
  assert.equal(status('logged_out').status, 1)
})

test('writeFiles creates files in the cwd to simulate edits', () => {
  const dir = tempDir()
  const work = join(dir, 'work')
  mkdirSync(work)
  const tool = writeFakeCli(dir, 'claude', { writeFiles: { 'notes/out.txt': 'draft' } })
  assert.equal(run(tool, ['-p', 'x'], { cwd: work }).status, 0)
  assert.equal(readFileSync(join(work, 'notes', 'out.txt'), 'utf8'), 'draft')
  assert.equal(existsSync(join(dir, 'notes')), false)
})

test('sleeps until terminated; ignoreSigterm survives SIGTERM until SIGKILL', async () => {
  const tool = writeFakeCli(tempDir(), 'claude', { sleepMs: 30_000 })
  const child = spawn(tool.path, ['-p', 'x'])
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve) => setTimeout(resolve, 300))
  child.kill('SIGTERM')
  assert.equal((await exited).signal, 'SIGTERM')

  tool.setBehavior({ sleepMs: 30_000, ignoreSigterm: true })
  const stubborn = spawn(tool.path, ['-p', 'x'])
  const stubbornExit = new Promise((resolve) => stubborn.on('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve) => setTimeout(resolve, 400))
  stubborn.kill('SIGTERM')
  const raced = await Promise.race([stubbornExit, new Promise((resolve) => setTimeout(() => resolve('alive'), 300))])
  assert.equal(raced, 'alive')
  stubborn.kill('SIGKILL')
  assert.equal((await stubbornExit).signal, 'SIGKILL')
})
