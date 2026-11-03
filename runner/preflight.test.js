import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as claude from './adapters/claude.js'
import * as codex from './adapters/codex.js'
import { runPreflight, buildChildEnv, defaultExecFile, PREFLIGHT_REASONS } from './preflight.js'

const CLAUDE_HELP = `Usage: claude [options]
  -p, --print   Print response and exit
  --output-format <format>
  --permission-mode <mode>
  --allowedTools, --allowed-tools <tools...>
`
const CODEX_HELP = `Usage: codex [OPTIONS]
  -s, --sandbox <SANDBOX_MODE>
  -C, --cd <DIR>
  -a, --ask-for-approval <APPROVAL_POLICY>
`
const CODEX_EXEC_HELP = `Usage: codex exec [OPTIONS]
  --skip-git-repo-check
  --color <COLOR>
`
const CLAUDE_OK = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'someone@example.com' })

const ok = (stdout = '', code = 0, stderr = '') => ({ code, stdout, stderr })

// Fake execFile: routes on "cmd arg arg", records every call, never spawns anything.
function fakeExec(routes) {
  const calls = []
  const fn = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env })
    const key = [cmd, ...args].join(' ')
    if (!(key in routes)) return { code: null, stdout: '', stderr: '', errorCode: 'ENOENT' }
    const r = routes[key]
    return typeof r === 'function' ? r() : r
  }
  fn.calls = calls
  return fn
}

const claudeRoutes = (over = {}) => ({
  'claude --help': ok(CLAUDE_HELP),
  'claude auth status --json': ok(CLAUDE_OK),
  ...over,
})
const codexRoutes = (over = {}) => ({
  'codex --help': ok(CODEX_HELP),
  'codex exec --help': ok(CODEX_EXEC_HELP),
  'codex login status': ok('Logged in using ChatGPT\n'),
  ...over,
})

const BASE_ENV = { PATH: '/usr/bin', HOME: '/home/u', LANG: 'en_US.UTF-8' }

describe('preflight: happy path', () => {
  test('claude subscription sign-in passes', async () => {
    const res = await runPreflight({ adapter: claude, env: BASE_ENV, execFile: fakeExec(claudeRoutes()) })
    assert.deepEqual(res, { ok: true, tool: 'claude' })
  })

  test('codex ChatGPT sign-in passes', async () => {
    const res = await runPreflight({ adapter: codex, env: BASE_ENV, execFile: fakeExec(codexRoutes()) })
    assert.deepEqual(res, { ok: true, tool: 'codex' })
  })

  test('reasons list matches the contract', () => {
    assert.deepEqual(
      Object.values(PREFLIGHT_REASONS).sort(),
      ['billing_guard', 'flags_unsupported', 'not_signed_in', 'tool_missing'],
    )
  })
})

describe('preflight: tool_missing and flags_unsupported', () => {
  test('tool not on PATH (ENOENT)', async () => {
    const res = await runPreflight({ adapter: claude, env: BASE_ENV, execFile: fakeExec({}) })
    assert.equal(res.ok, false)
    assert.equal(res.reason, 'tool_missing')
    assert.equal(typeof res.message, 'string')
  })

  test('--help lacking a required flag fails closed', async () => {
    const help = CLAUDE_HELP.replace('--permission-mode <mode>', '')
    const exec = fakeExec(claudeRoutes({ 'claude --help': ok(help) }))
    const res = await runPreflight({ adapter: claude, env: BASE_ENV, execFile: exec })
    assert.equal(res.reason, 'flags_unsupported')
    assert.match(res.message, /--permission-mode/)
    // never reaches the sign-in check
    assert.equal(exec.calls.some((c) => c.args.includes('status')), false)
  })

  test('codex exec-level flag missing is detected', async () => {
    const exec = fakeExec(codexRoutes({ 'codex exec --help': ok('Usage: codex exec\n') }))
    const res = await runPreflight({ adapter: codex, env: BASE_ENV, execFile: exec })
    assert.equal(res.reason, 'flags_unsupported')
    assert.match(res.message, /--skip-git-repo-check/)
  })

  test('required flags are matched as whole flags, not substrings', async () => {
    const help = CODEX_HELP.replace('--cd <DIR>', '--cdx <DIR>')
    const res = await runPreflight({ adapter: codex, env: BASE_ENV, execFile: fakeExec(codexRoutes({ 'codex --help': ok(help) })) })
    assert.equal(res.reason, 'flags_unsupported')
    assert.match(res.message, /--cd\b/)
  })

  test('a custom tool path is used for every call', async () => {
    const exec = fakeExec({
      '/opt/bin/claude --help': ok(CLAUDE_HELP),
      '/opt/bin/claude auth status --json': ok(CLAUDE_OK),
    })
    const res = await runPreflight({ adapter: claude, env: BASE_ENV, execFile: exec, toolPath: '/opt/bin/claude' })
    assert.equal(res.ok, true)
    assert.ok(exec.calls.every((c) => c.cmd === '/opt/bin/claude'))
  })
})

describe('preflight: billing guard layer 1 (environment)', () => {
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) {
    for (const adapter of [claude, codex]) {
      test(`${name} set => billing_guard for ${adapter.tool}, nothing is spawned`, async () => {
        const exec = fakeExec({ ...claudeRoutes(), ...codexRoutes() })
        const res = await runPreflight({ adapter, env: { ...BASE_ENV, [name]: 'sk-test-secret-value' }, execFile: exec })
        assert.equal(res.ok, false)
        assert.equal(res.reason, 'billing_guard')
        assert.equal(exec.calls.length, 0)
        assert.match(res.message, new RegExp(name))
        assert.doesNotMatch(JSON.stringify(res), /sk-test-secret-value/)
      })
    }
  }

  test('an empty-string key still trips the guard (fail closed)', async () => {
    const res = await runPreflight({ adapter: claude, env: { ...BASE_ENV, ANTHROPIC_API_KEY: '' }, execFile: fakeExec(claudeRoutes()) })
    assert.equal(res.reason, 'billing_guard')
  })

  test('other provider-billing switches also trip the guard', async () => {
    for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
      const res = await runPreflight({ adapter: claude, env: { ...BASE_ENV, [name]: '1' }, execFile: fakeExec(claudeRoutes()) })
      assert.equal(res.reason, 'billing_guard', name)
    }
  })
})

describe('preflight: billing guard layer 2 (login mode), claude', () => {
  const run = (stdout, code = 0) =>
    runPreflight({ adapter: claude, env: BASE_ENV, execFile: fakeExec(claudeRoutes({ 'claude auth status --json': ok(stdout, code) })) })

  test('API-key login => billing_guard', async () => {
    const res = await run(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }))
    assert.equal(res.reason, 'billing_guard')
  })

  test('any non-subscription method => billing_guard', async () => {
    for (const authMethod of ['console', 'apiKeyHelper', 'oauth_token', 'unknown-method']) {
      const res = await run(JSON.stringify({ loggedIn: true, authMethod, apiProvider: 'firstParty' }))
      assert.equal(res.reason, 'billing_guard', authMethod)
    }
  })

  test('third-party provider (bedrock/vertex) => billing_guard', async () => {
    const res = await run(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }))
    assert.equal(res.reason, 'billing_guard')
  })

  test('no authMethod named => billing_guard', async () => {
    assert.equal((await run(JSON.stringify({ loggedIn: true }))).reason, 'billing_guard')
  })

  test('unparseable output => billing_guard (fail closed), nothing echoed', async () => {
    const res = await run('Welcome back SECRET-ACCOUNT-NAME <html>')
    assert.equal(res.reason, 'billing_guard')
    assert.doesNotMatch(JSON.stringify(res), /SECRET-ACCOUNT-NAME/)
  })

  test('JSON that is not an object => billing_guard', async () => {
    assert.equal((await run('"claude.ai"')).reason, 'billing_guard')
    assert.equal((await run('null')).reason, 'billing_guard')
  })

  test('status command that cannot run => billing_guard', async () => {
    const exec = fakeExec({ 'claude --help': ok(CLAUDE_HELP), 'claude auth status --json': { code: null, stdout: '', stderr: '', errorCode: 'EACCES' } })
    const res = await runPreflight({ adapter: claude, env: BASE_ENV, execFile: exec })
    assert.equal(res.reason, 'billing_guard')
  })

  test('loggedIn false (non-zero exit) => not_signed_in', async () => {
    const res = await run(JSON.stringify({ loggedIn: false }), 1)
    assert.equal(res.reason, 'not_signed_in')
  })

  test('loggedIn true but non-zero exit still reads the JSON', async () => {
    const res = await run(CLAUDE_OK, 1)
    assert.equal(res.ok, true)
  })
})

describe('preflight: billing guard layer 2 (login mode), codex', () => {
  const run = (out, code = 0, stream = 'stdout') =>
    runPreflight({
      adapter: codex,
      env: BASE_ENV,
      execFile: fakeExec(codexRoutes({ 'codex login status': ok(stream === 'stdout' ? out : '', code, stream === 'stderr' ? out : '') })),
    })

  test('API-key login => billing_guard', async () => {
    assert.equal((await run('Logged in using an API key - sk-proj-***abcd\n')).reason, 'billing_guard')
  })

  test('status printed on stderr is read too', async () => {
    assert.equal((await run('Logged in using ChatGPT\n', 0, 'stderr')).ok, true)
    assert.equal((await run('Logged in using an API key - sk-x\n', 0, 'stderr')).reason, 'billing_guard')
  })

  test('unparseable output => billing_guard (fail closed)', async () => {
    const res = await run('Something unexpected: SECRET-CODEX-DETAIL')
    assert.equal(res.reason, 'billing_guard')
    assert.doesNotMatch(JSON.stringify(res), /SECRET-CODEX-DETAIL/)
  })

  test('empty output with exit 0 => billing_guard', async () => {
    assert.equal((await run('')).reason, 'billing_guard')
  })

  test('a line that mentions ChatGPT and an API key is refused', async () => {
    assert.equal((await run('Logged in using ChatGPT\nAPI key also configured\n')).reason, 'billing_guard')
  })

  test('not logged in => not_signed_in', async () => {
    const res = await run('Not logged in\n', 1)
    assert.equal(res.reason, 'not_signed_in')
  })
})

describe('preflight: child environment allowlist and no logging', () => {
  const NOISY_ENV = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm',
    TMPDIR: '/tmp',
    CODEX_HOME: '/home/u/.codex',
    CLAUDE_CONFIG_DIR: '/home/u/.claude',
    GITHUB_TOKEN: 'ghp_secret',
    AWS_SECRET_ACCESS_KEY: 'aws_secret',
    MY_PASSWORD: 'pw',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    NPM_TOKEN: 'npm_secret',
  }

  test('buildChildEnv keeps only allowlisted names', () => {
    const env = buildChildEnv(NOISY_ENV)
    assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'TERM', 'TMPDIR'])
  })

  test('buildChildEnv never lets a billing key through even if present', () => {
    const env = buildChildEnv({ ...NOISY_ENV, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', CODEX_API_KEY: 'c', ANTHROPIC_AUTH_TOKEN: 'd' })
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) assert.equal(k in env, false)
  })

  test('buildChildEnv skips undefined values and does not mutate the input', () => {
    const input = { PATH: '/x', HOME: undefined }
    const env = buildChildEnv(input)
    assert.deepEqual(env, { PATH: '/x' })
    assert.deepEqual(input, { PATH: '/x', HOME: undefined })
  })

  test('every spawned preflight command gets the allowlisted environment only', async () => {
    const exec = fakeExec(claudeRoutes())
    await runPreflight({ adapter: claude, env: NOISY_ENV, execFile: exec })
    assert.ok(exec.calls.length >= 2)
    for (const call of exec.calls) {
      assert.ok(call.env, 'env must be passed explicitly')
      assert.equal('GITHUB_TOKEN' in call.env, false)
      assert.equal('AWS_SECRET_ACCESS_KEY' in call.env, false)
      assert.equal(call.env.PATH, '/usr/bin')
    }
  })

  test('nothing is logged and results never contain the env or raw status output', async () => {
    const logged = []
    const methods = ['log', 'error', 'warn', 'info', 'debug']
    const saved = methods.map((m) => console[m])
    methods.forEach((m) => { console[m] = (...a) => logged.push(a) })
    const stdoutWrite = process.stdout.write
    const stderrWrite = process.stderr.write
    process.stdout.write = (...a) => { logged.push(a); return true }
    process.stderr.write = (...a) => { logged.push(a); return true }
    let results
    try {
      const routes = {
        'claude --help': ok(CLAUDE_HELP),
        'claude auth status --json': ok(JSON.stringify({ loggedIn: true, authMethod: 'api_key', email: 'leak@example.com', orgName: 'LEAKY-ORG' })),
      }
      results = [
        await runPreflight({ adapter: claude, env: NOISY_ENV, execFile: fakeExec(routes) }),
        await runPreflight({ adapter: claude, env: NOISY_ENV, execFile: fakeExec({}) }),
        await runPreflight({ adapter: claude, env: { ...NOISY_ENV, ANTHROPIC_API_KEY: 'sk-leak' }, execFile: fakeExec(routes) }),
      ]
    } finally {
      methods.forEach((m, i) => { console[m] = saved[i] })
      process.stdout.write = stdoutWrite
      process.stderr.write = stderrWrite
    }
    assert.equal(logged.length, 0)
    const dump = JSON.stringify(results)
    for (const secret of ['leak@example.com', 'LEAKY-ORG', 'ghp_secret', 'aws_secret', 'sk-leak', '/home/u']) {
      assert.equal(dump.includes(secret), false, secret)
    }
  })
})

describe('defaultExecFile', () => {
  test('resolves with code, stdout and stderr and never rejects', async () => {
    const res = await defaultExecFile(process.execPath, ['-e', 'process.stdout.write("hi"); process.stderr.write("err"); process.exit(3)'], { env: { PATH: process.env.PATH } })
    assert.deepEqual({ code: res.code, stdout: res.stdout, stderr: res.stderr }, { code: 3, stdout: 'hi', stderr: 'err' })
  })

  test('reports ENOENT for a missing binary', async () => {
    const res = await defaultExecFile('kairos-no-such-binary-xyz', [], { env: {} })
    assert.equal(res.errorCode, 'ENOENT')
    assert.equal(res.code, null)
  })

  test('uses only the env it is given', async () => {
    const res = await defaultExecFile(process.execPath, ['-e', 'process.stdout.write(String(process.env.KAIROS_PREFLIGHT_PROBE))'], { env: { PATH: process.env.PATH } })
    assert.equal(res.stdout, 'undefined')
  })

  test('enforces a timeout', async () => {
    const res = await defaultExecFile(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { env: { PATH: process.env.PATH }, timeout: 200 })
    assert.equal(res.timedOut, true)
  })
})
