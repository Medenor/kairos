// Claude adapter (contracts/runner-cli.md, research D5): print mode, JSON output, dontAsk
// permission mode, explicit file-tool allow-list without a shell tool, turn limit.

import { buildChildEnv } from '../preflight.js'
import { NEEDS_INPUT_MARKER } from './prompt.js'

export { buildPrompt } from './prompt.js'

export const tool = 'claude'

// Path-scoped allow rules (gitignore syntax; `./` anchors at the session cwd, i.e. the disposable copy).
// Bare tool names would allow those tools on any path, so none are listed. `Edit(...)` covers every
// file-editing tool (Edit and Write); `Read(...)` covers Read and, best effort, Glob and Grep. Reads
// inside the cwd need no approval under dontAsk, and everything not allowed here is auto-denied.
// No Bash or other shell tool. Symlinks: an allow rule only matches when both the requested path and
// the file it resolves to are inside the cwd, so a link leading out of the copy is not allowed.
export const ALLOWED_TOOLS = Object.freeze(['Read(./**)', 'Edit(./**)'])
// Defence in depth: deny rules win over allow rules and also match a symlink's target. A Read deny rule
// also blocks Edit and Write on the same path. Credential folders reachable through HOME.
export const DENIED_TOOLS = Object.freeze([
  'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.gnupg/**)', 'Read(~/.config/**)',
  'Read(~/.claude/**)', 'Read(~/.codex/**)', 'Read(~/.netrc)', 'Read(~/.npmrc)',
])
// Hard bound on agent turns. The duration bound is the loop's hard-stop timer.
export const MAX_TURNS = 40

// `--max-turns` is accepted by the CLI in print mode but not listed in `--help`, so it is not checked there.
export function requiredFlags() {
  return ['--print', '--output-format', '--permission-mode', '--allowedTools']
}

export function helpArgs() {
  return [['--help']]
}

// `maxMinutes` is enforced by the caller's timer, not by a CLI flag.
export function buildInvocation({ prompt, cwd, env = process.env, toolPath } = {}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('claude adapter: prompt is required')
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) throw new Error('claude adapter: cwd must be an absolute path')
  return {
    cmd: toolPath || tool,
    args: [
      '-p',
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--allowedTools', ALLOWED_TOOLS.join(','),
      '--disallowedTools', DENIED_TOOLS.join(','),
      '--max-turns', String(MAX_TURNS),
      '--', prompt,
    ],
    env: buildChildEnv(env),
    cwd,
  }
}

function classify(message) {
  if (/credit balance|billing/i.test(message)) {
    return { code: 'billing_guard', message: 'The tool reported a billing problem outside the subscription.' }
  }
  if (/not logged in|run \/login|invalid api key|authentication_error|unauthori[sz]ed|\b401\b|token (has )?expired|please (log ?in|sign ?in)/i.test(message)) {
    return { code: 'not_signed_in', message: 'claude is not signed in or its sign-in expired.' }
  }
  if (/usage limit|limit reached|rate limit|hit your limit|quota/i.test(message)) {
    return { code: 'quota_exhausted', message: 'claude reported that the usage limit is reached.' }
  }
  return null
}

function readResult(stdout) {
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (Array.isArray(data)) data = [...data].reverse().find((m) => m && m.type === 'result')
  return data && typeof data === 'object' ? data : null
}

export function parseResult({ code, stdout = '', stderr = '' }) {
  const data = readResult(stdout)
  const resultText = data && typeof data.result === 'string' ? data.result.trim() : ''
  const errText = stderr.trim()

  if (code === null || code === undefined) {
    return { status: 'failed', needsInput: false, failureReason: { code: 'interrupted', message: 'The process was stopped before it finished.' }, text: resultText }
  }

  const success = code === 0 && data && data.is_error !== true && (data.subtype === undefined || data.subtype === 'success')
  if (success) {
    if (resultText.startsWith(NEEDS_INPUT_MARKER)) {
      return { status: 'needs_input', needsInput: true, failureReason: null, text: resultText.slice(NEEDS_INPUT_MARKER.length).trim() }
    }
    return { status: 'completed', needsInput: false, failureReason: null, text: resultText }
  }

  const text = resultText || errText || (code === 0 ? '' : stdout.trim())
  let failureReason
  if (data && data.subtype === 'error_max_turns') {
    failureReason = { code: 'timeout', message: 'The turn limit was reached before the task finished.' }
  } else {
    failureReason = classify(`${resultText}\n${errText}`)
  }
  return { status: 'failed', needsInput: false, failureReason, text }
}
