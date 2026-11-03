import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as claude from './adapters/claude.js'
import * as codex from './adapters/codex.js'
import { buildPrompt } from './adapters/prompt.js'
import { FAILURE_REASONS } from '../src/surplus/records.js'

const SHELL_TOOLS = /bash|shell|exec|terminal|powershell/i
const ENV = { PATH: '/usr/bin', HOME: '/home/u', LANG: 'C', ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-y', CODEX_API_KEY: 'sk-z', GITHUB_TOKEN: 'ghp' }
const idea = { text: 'Write a README for this folder', context: 'Audience: new contributors' }

describe('prompt (FR-024)', () => {
  test('contains the idea text and context', () => {
    const p = buildPrompt(idea)
    assert.ok(p.includes(idea.text))
    assert.ok(p.includes(idea.context))
  })

  test('states non-interactive, no questions possible, results are drafts', () => {
    const p = buildPrompt(idea)
    assert.match(p, /non-interactive/i)
    assert.match(p, /cannot (ask|request)|no (human|information can be requested)/i)
    assert.match(p, /draft/i)
    assert.match(p, /NEEDS_INPUT:/)
  })

  test('omits the context section when there is no context', () => {
    const p = buildPrompt({ text: 'Only text', context: '' })
    assert.ok(p.includes('Only text'))
    assert.doesNotMatch(p, /Context:/)
  })

  test('only the supplied idea fields can reach the prompt', () => {
    const p = buildPrompt({
      text: 'T', context: 'C', quota: 42, otherIdeas: ['SECRET-OTHER-IDEA'], weeklyPct: 77, folder: '/Users/x/secret',
    })
    for (const leaked of ['SECRET-OTHER-IDEA', '42', '77', '/Users/x/secret']) assert.equal(p.includes(leaked), false, leaked)
  })

  test('an idea with a working folder is told its folder is a disposable copy', () => {
    const p = buildPrompt({ ...idea, workingFolder: 'proj' })
    assert.match(p, /disposable copy/)
    assert.doesNotMatch(p, /no project files/i)
    assert.ok(!p.includes('proj'), 'the folder path is never part of the prompt')
  })

  test('an idea without a working folder is told no project files exist and the work is limited to drafts', () => {
    for (const folderless of [{}, { workingFolder: null }, { workingFolder: '' }, { workingFolder: '   ' }]) {
      const p = buildPrompt({ ...idea, ...folderless })
      assert.match(p, /no project files/i)
      assert.match(p, /limited to drafts/i)
      assert.match(p, /idea text and (its )?context/i)
      assert.ok(p.includes(idea.text) && p.includes(idea.context))
      assert.doesNotMatch(p, /disposable copy/)
      assert.match(p, /NEEDS_INPUT:/)
      assert.match(p, /non-interactive/i)
    }
  })

  test('rejects a missing text', () => {
    assert.throws(() => buildPrompt({ text: '', context: 'x' }), /text/)
    assert.throws(() => buildPrompt(), /text/)
  })
})

describe('claude adapter', () => {
  const inv = () => claude.buildInvocation({ prompt: 'PROMPT-BODY', cwd: '/runs/r1/work', maxMinutes: 30, env: ENV })
  const flagValue = (args, flag) => args[args.indexOf(flag) + 1]

  test('identity and required flags', () => {
    assert.equal(claude.tool, 'claude')
    const flags = claude.requiredFlags()
    for (const f of ['--print', '--output-format', '--permission-mode', '--allowedTools']) assert.ok(flags.includes(f), f)
    assert.ok(flags.every((f) => f.startsWith('--')))
  })

  test('non-interactive print mode with JSON output', () => {
    const { cmd, args } = inv()
    assert.equal(cmd, 'claude')
    assert.ok(args.includes('-p') || args.includes('--print'))
    assert.equal(flagValue(args, '--output-format'), 'json')
  })

  test('permission mode dontAsk', () => {
    assert.equal(flagValue(inv().args, '--permission-mode'), 'dontAsk')
  })

  test('explicit file-tool allow-list without a shell tool', () => {
    const tools = flagValue(inv().args, '--allowedTools').split(',')
    assert.ok(tools.length > 0)
    assert.ok(tools.includes('Read') && tools.includes('Edit'))
    for (const t of tools) assert.doesNotMatch(t, SHELL_TOOLS, t)
    assert.equal(tools.includes('*'), false)
    assert.equal(inv().args.includes('--dangerously-skip-permissions'), false)
  })

  test('turn limit is a positive integer', () => {
    const n = Number(flagValue(inv().args, '--max-turns'))
    assert.ok(Number.isInteger(n) && n > 0 && n <= 200)
  })

  test('prompt is passed after "--" as the last argument, so it cannot be read as a flag', () => {
    const { args } = claude.buildInvocation({ prompt: '--dangerously-skip-permissions please', cwd: '/w', maxMinutes: 5, env: ENV })
    assert.equal(args[args.length - 1], '--dangerously-skip-permissions please')
    assert.equal(args[args.length - 2], '--')
  })

  test('env is allowlisted: no billing keys, no unrelated secrets', () => {
    const { env } = inv()
    assert.equal(env.PATH, '/usr/bin')
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GITHUB_TOKEN']) assert.equal(k in env, false)
  })

  test('cwd is returned for the spawner and the tool path is overridable', () => {
    const r = claude.buildInvocation({ prompt: 'p', cwd: '/runs/r1/work', maxMinutes: 1, env: ENV, toolPath: '/opt/claude' })
    assert.equal(r.cwd, '/runs/r1/work')
    assert.equal(r.cmd, '/opt/claude')
  })

  test('requires a prompt and an absolute cwd', () => {
    assert.throws(() => claude.buildInvocation({ prompt: '', cwd: '/w', env: ENV }), /prompt/)
    assert.throws(() => claude.buildInvocation({ prompt: 'p', cwd: 'relative', env: ENV }), /cwd/)
  })
})

describe('claude parseResult', () => {
  const json = (o) => JSON.stringify({ type: 'result', is_error: false, subtype: 'success', num_turns: 3, ...o })

  test('exit 0 with a success result => completed', () => {
    const r = claude.parseResult({ code: 0, stdout: json({ result: 'Done. Created README.md' }), stderr: '' })
    assert.deepEqual(r, { status: 'completed', needsInput: false, failureReason: null, text: 'Done. Created README.md' })
  })

  test('empty result is still completed with empty text', () => {
    const r = claude.parseResult({ code: 0, stdout: json({ result: '' }), stderr: '' })
    assert.equal(r.status, 'completed')
    assert.equal(r.text, '')
  })

  test('NEEDS_INPUT marker => needs_input with the question as text', () => {
    const r = claude.parseResult({ code: 0, stdout: json({ result: 'NEEDS_INPUT: Which license should I use?' }), stderr: '' })
    assert.equal(r.status, 'needs_input')
    assert.equal(r.needsInput, true)
    assert.equal(r.failureReason, null)
    assert.equal(r.text, 'Which license should I use?')
  })

  test('marker is only honoured at the start of the answer', () => {
    const r = claude.parseResult({ code: 0, stdout: json({ result: 'I wrote a note: NEEDS_INPUT: is fine' }), stderr: '' })
    assert.equal(r.status, 'completed')
  })

  test('is_error => failed', () => {
    const r = claude.parseResult({ code: 1, stdout: json({ is_error: true, subtype: 'success', result: 'Something broke' }), stderr: '' })
    assert.equal(r.status, 'failed')
    assert.equal(r.needsInput, false)
    assert.equal(r.text, 'Something broke')
  })

  test('max turns => failed with timeout reason', () => {
    const r = claude.parseResult({ code: 1, stdout: json({ is_error: true, subtype: 'error_max_turns' }), stderr: '' })
    assert.equal(r.status, 'failed')
    assert.equal(r.failureReason.code, FAILURE_REASONS.TIMEOUT)
    assert.equal(typeof r.failureReason.message, 'string')
  })

  test('authentication problems => not_signed_in', () => {
    const r = claude.parseResult({ code: 1, stdout: json({ is_error: true, result: 'Invalid API key - Please run /login' }), stderr: '' })
    assert.equal(r.failureReason.code, FAILURE_REASONS.NOT_SIGNED_IN)
    const r2 = claude.parseResult({ code: 1, stdout: '', stderr: 'Not logged in. Please run claude login' })
    assert.equal(r2.failureReason.code, FAILURE_REASONS.NOT_SIGNED_IN)
  })

  test('usage limit => quota_exhausted', () => {
    const r = claude.parseResult({ code: 1, stdout: json({ is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm' }), stderr: '' })
    assert.equal(r.failureReason.code, FAILURE_REASONS.QUOTA_EXHAUSTED)
  })

  test('credit-balance / API billing message => billing_guard', () => {
    const r = claude.parseResult({ code: 1, stdout: json({ is_error: true, result: 'Credit balance is too low' }), stderr: '' })
    assert.equal(r.failureReason.code, FAILURE_REASONS.BILLING_GUARD)
  })

  test('non-zero exit with unparseable stdout => failed, text from stderr', () => {
    const r = claude.parseResult({ code: 2, stdout: 'garbage', stderr: 'boom happened' })
    assert.equal(r.status, 'failed')
    assert.equal(r.text, 'boom happened')
  })

  test('exit 0 with unparseable stdout is not trusted as success', () => {
    const r = claude.parseResult({ code: 0, stdout: 'not json', stderr: '' })
    assert.equal(r.status, 'failed')
  })

  test('killed by signal (code null) => failed, interrupted', () => {
    const r = claude.parseResult({ code: null, stdout: '', stderr: '' })
    assert.equal(r.status, 'failed')
    assert.equal(r.failureReason.code, FAILURE_REASONS.INTERRUPTED)
  })

  test('every produced reason is a known failure reason', () => {
    const known = Object.values(FAILURE_REASONS)
    for (const out of [
      { code: 1, stdout: json({ is_error: true, subtype: 'error_max_turns' }), stderr: '' },
      { code: 1, stdout: '', stderr: 'Not logged in' },
      { code: null, stdout: '', stderr: '' },
    ]) assert.ok(known.includes(claude.parseResult(out).failureReason.code))
  })
})

describe('codex adapter', () => {
  const inv = () => codex.buildInvocation({ prompt: 'PROMPT-BODY', cwd: '/runs/r1/work', maxMinutes: 30, env: ENV })
  const flagValue = (args, flag) => args[args.indexOf(flag) + 1]

  test('identity and required flags', () => {
    assert.equal(codex.tool, 'codex')
    const flags = codex.requiredFlags()
    for (const f of ['--sandbox', '--cd', '--ask-for-approval']) assert.ok(flags.includes(f), f)
  })

  test('uses exec', () => {
    const { cmd, args } = inv()
    assert.equal(cmd, 'codex')
    assert.ok(args.includes('exec'))
  })

  test('workspace-write sandbox, never bypassed', () => {
    const { args } = inv()
    assert.equal(flagValue(args, '--sandbox'), 'workspace-write')
    assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false)
    assert.equal(args.includes('danger-full-access'), false)
  })

  test('approvals never, set before the exec subcommand', () => {
    const { args } = inv()
    assert.equal(flagValue(args, '--ask-for-approval'), 'never')
    assert.ok(args.indexOf('--ask-for-approval') < args.indexOf('exec'))
  })

  test('the copy is the working directory (--cd and cwd)', () => {
    const r = inv()
    assert.equal(flagValue(r.args, '--cd'), '/runs/r1/work')
    assert.equal(r.cwd, '/runs/r1/work')
  })

  test('copy is not assumed to be a git repo', () => {
    assert.ok(inv().args.includes('--skip-git-repo-check'))
  })

  test('prompt is the last argument after "--"', () => {
    const { args } = codex.buildInvocation({ prompt: '--sandbox danger-full-access', cwd: '/w', maxMinutes: 5, env: ENV })
    assert.equal(args[args.length - 1], '--sandbox danger-full-access')
    assert.equal(args[args.length - 2], '--')
  })

  test('env is allowlisted: no billing keys, no unrelated secrets', () => {
    const { env } = inv()
    assert.equal(env.PATH, '/usr/bin')
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GITHUB_TOKEN']) assert.equal(k in env, false)
  })

  test('tool path override; prompt and cwd validated', () => {
    assert.equal(codex.buildInvocation({ prompt: 'p', cwd: '/w', env: ENV, toolPath: '/opt/codex' }).cmd, '/opt/codex')
    assert.throws(() => codex.buildInvocation({ prompt: ' ', cwd: '/w', env: ENV }), /prompt/)
    assert.throws(() => codex.buildInvocation({ prompt: 'p', cwd: '', env: ENV }), /cwd/)
  })

  test('help commands cover exec-level flags', () => {
    assert.deepEqual(codex.helpArgs(), [['--help'], ['exec', '--help']])
    assert.ok(codex.requiredFlags().includes('--skip-git-repo-check'))
  })
})

describe('codex parseResult', () => {
  test('exit 0 => completed with stdout as text', () => {
    const r = codex.parseResult({ code: 0, stdout: 'All done.\n', stderr: 'progress noise' })
    assert.deepEqual(r, { status: 'completed', needsInput: false, failureReason: null, text: 'All done.' })
  })

  test('empty output => completed with empty text', () => {
    const r = codex.parseResult({ code: 0, stdout: '', stderr: '' })
    assert.equal(r.status, 'completed')
    assert.equal(r.text, '')
  })

  test('NEEDS_INPUT marker => needs_input', () => {
    const r = codex.parseResult({ code: 0, stdout: 'NEEDS_INPUT: What is the target branch?\n', stderr: '' })
    assert.equal(r.status, 'needs_input')
    assert.equal(r.needsInput, true)
    assert.equal(r.text, 'What is the target branch?')
  })

  test('non-zero exit => failed, text from stderr when stdout is empty', () => {
    const r = codex.parseResult({ code: 1, stdout: '', stderr: 'sandbox error' })
    assert.equal(r.status, 'failed')
    assert.equal(r.needsInput, false)
    assert.equal(r.text, 'sandbox error')
  })

  test('not logged in / expired token => not_signed_in', () => {
    const r = codex.parseResult({ code: 1, stdout: '', stderr: 'Not logged in. Run codex login' })
    assert.equal(r.failureReason.code, FAILURE_REASONS.NOT_SIGNED_IN)
    const r2 = codex.parseResult({ code: 1, stdout: '', stderr: '401 Unauthorized: token expired' })
    assert.equal(r2.failureReason.code, FAILURE_REASONS.NOT_SIGNED_IN)
  })

  test('usage limit => quota_exhausted', () => {
    const r = codex.parseResult({ code: 1, stdout: '', stderr: 'You have hit your usage limit. Try again later.' })
    assert.equal(r.failureReason.code, FAILURE_REASONS.QUOTA_EXHAUSTED)
  })

  test('signal kill => failed, interrupted', () => {
    const r = codex.parseResult({ code: null, stdout: 'partial', stderr: '' })
    assert.equal(r.status, 'failed')
    assert.equal(r.failureReason.code, FAILURE_REASONS.INTERRUPTED)
    assert.equal(r.text, 'partial')
  })

  test('generic failure has no failure reason code but a failed status', () => {
    const r = codex.parseResult({ code: 7, stdout: '', stderr: 'weird' })
    assert.equal(r.status, 'failed')
    assert.equal(r.failureReason, null)
  })
})
