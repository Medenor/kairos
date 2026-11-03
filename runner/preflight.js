// Preflight checks before an automatic run (contracts/runner-cli.md, research D5, FR-015).
//
// Order: environment billing guard (nothing spawned), tool present and required flags in
// `--help`, then login mode (subscription sign-in only). Every doubt fails closed.
// This module never logs, and never returns raw tool output or any environment value:
// messages are fixed strings (variable and flag names only).

import { execFile as nodeExecFile } from 'node:child_process'

export const PREFLIGHT_REASONS = Object.freeze({
  TOOL_MISSING: 'tool_missing',
  FLAGS_UNSUPPORTED: 'flags_unsupported',
  NOT_SIGNED_IN: 'not_signed_in',
  BILLING_GUARD: 'billing_guard',
})

// Presence of any of these means a run could be billed outside the subscription.
const BILLING_ENV_VARS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
])

// Child environment allowlist: what a CLI needs to run and to find its own login.
// No credential-like variable is listed; LC_* is allowed by prefix.
const ENV_ALLOWLIST = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'TMPDIR', 'TZ', 'NO_COLOR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
  'CODEX_HOME', 'CLAUDE_CONFIG_DIR',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
])

const STATUS_TIMEOUT_MS = 20000
const MAX_BUFFER = 1024 * 1024

export function buildChildEnv(source = process.env) {
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (ENV_ALLOWLIST.includes(key) || key.startsWith('LC_')) out[key] = value
  }
  return out
}

// Resolves (never rejects) with { code, stdout, stderr, errorCode, timedOut }.
export function defaultExecFile(cmd, args, { env = {}, timeout = STATUS_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = nodeExecFile(
        cmd,
        args,
        { env, timeout, cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true },
        (error, stdout, stderr) => {
          const out = { code: 0, stdout: stdout ?? '', stderr: stderr ?? '', errorCode: null, timedOut: false }
          if (error) {
            if (typeof error.code === 'number') out.code = error.code
            else {
              out.code = null
              out.errorCode = typeof error.code === 'string' ? error.code : 'UNKNOWN'
            }
            if (error.killed && error.signal) {
              out.code = null
              out.timedOut = true
            }
          }
          resolve(out)
        },
      )
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', errorCode: typeof error?.code === 'string' ? error.code : 'UNKNOWN', timedOut: false })
      return
    }
    child.stdin?.end()
  })
}

const fail = (reason, message) => ({ ok: false, reason, message })

function hasFlag(helpText, flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`).test(helpText)
}

// Claude: `claude auth status --json`. Only the first-party subscription sign-in is accepted.
function checkClaudeLogin({ stdout, stderr }) {
  const raw = (stdout.trim() || stderr.trim())
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'Login mode of claude could not be verified (unreadable status). Refusing to run.')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'Login mode of claude could not be verified (unexpected status). Refusing to run.')
  }
  if (data.loggedIn === false) return fail(PREFLIGHT_REASONS.NOT_SIGNED_IN, 'claude is not signed in. Sign in with your subscription account.')
  if (data.loggedIn !== true) {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'Login mode of claude could not be verified (no sign-in state). Refusing to run.')
  }
  if (data.authMethod !== 'claude.ai' || (data.apiProvider !== undefined && data.apiProvider !== 'firstParty')) {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'claude is not using the subscription sign-in (API key or other provider). Refusing to run.')
  }
  return { ok: true }
}

// Codex: `codex login status` prints a sentence such as "Logged in using ChatGPT".
function checkCodexLogin({ code, stdout, stderr }) {
  const lines = `${stdout}\n${stderr}`.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.some((l) => /api[\s_-]?key/i.test(l))) {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'codex is not using the subscription sign-in (API key). Refusing to run.')
  }
  if (lines.some((l) => /^not logged in/i.test(l))) {
    return fail(PREFLIGHT_REASONS.NOT_SIGNED_IN, 'codex is not signed in. Sign in with your ChatGPT account.')
  }
  if (code === 0 && lines.some((l) => /^logged in using chatgpt\b/i.test(l))) return { ok: true }
  return fail(PREFLIGHT_REASONS.BILLING_GUARD, 'Login mode of codex could not be verified (unrecognised status). Refusing to run.')
}

const LOGIN_CHECKS = {
  claude: { args: ['auth', 'status', '--json'], parse: checkClaudeLogin },
  codex: { args: ['login', 'status'], parse: checkCodexLogin },
}

/**
 * @param {{ adapter: {tool: string, requiredFlags: () => string[], helpArgs?: () => string[][]},
 *           env?: Record<string, string|undefined>, execFile?: Function, toolPath?: string }} options
 * @returns {Promise<{ok: true, tool: string} | {ok: false, reason: string, message: string}>}
 */
export async function runPreflight({ adapter, env = process.env, execFile = defaultExecFile, toolPath } = {}) {
  const tool = adapter.tool
  const cmd = toolPath || tool

  // Layer 1: environment. Presence alone (even empty) fails closed; nothing is spawned.
  const present = BILLING_ENV_VARS.filter((name) => env[name] !== undefined)
  if (present.length > 0) {
    return fail(
      PREFLIGHT_REASONS.BILLING_GUARD,
      `Billing guard: ${present.join(', ')} set in the runner environment. Unset it so runs use the subscription only.`,
    )
  }

  const childEnv = buildChildEnv(env)
  const run = (args) => execFile(cmd, args, { env: childEnv, timeout: STATUS_TIMEOUT_MS })

  // Tool present and required flags supported.
  const helpSets = typeof adapter.helpArgs === 'function' ? adapter.helpArgs() : [['--help']]
  let helpText = ''
  for (const args of helpSets) {
    const res = await run(args)
    if (res.errorCode) return fail(PREFLIGHT_REASONS.TOOL_MISSING, `${tool} was not found or cannot be run.`)
    helpText += `\n${res.stdout}\n${res.stderr}`
  }
  const missing = adapter.requiredFlags().filter((flag) => !hasFlag(helpText, flag))
  if (missing.length > 0) {
    return fail(PREFLIGHT_REASONS.FLAGS_UNSUPPORTED, `${tool} does not list required flags: ${missing.join(', ')}.`)
  }

  // Layer 2: login mode.
  const login = LOGIN_CHECKS[tool]
  if (!login) return fail(PREFLIGHT_REASONS.BILLING_GUARD, `Login mode of ${tool} cannot be verified. Refusing to run.`)
  const status = await run(login.args)
  if (status.errorCode || status.timedOut) {
    return fail(PREFLIGHT_REASONS.BILLING_GUARD, `Login mode of ${tool} could not be verified (status command failed). Refusing to run.`)
  }
  const verdict = login.parse(status)
  return verdict.ok ? { ok: true, tool } : verdict
}
