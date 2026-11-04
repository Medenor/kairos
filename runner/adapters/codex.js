// Codex adapter (contracts/runner-cli.md, research D5): `exec`, workspace-write sandbox, approvals never, the
// disposable copy as working directory. Hardened form (2026-11-04 canary): the user config and rules are ignored so a
// personal `approvals_reviewer = "auto_review"` or an allow rule cannot bypass the sandbox, and approval policy and
// reviewer are pinned with `-c`. Writes outside the copy are blocked; READS OUTSIDE THE COPY ARE NOT CONTAINED
// (workspace-write grants read on /), so the loop runs Codex automatically only with `allowCodexAuto`.

import { buildChildEnv } from '../preflight.js'
import { NEEDS_INPUT_MARKER } from './prompt.js'

export { buildPrompt } from './prompt.js'

export const tool = 'codex'

export function requiredFlags() {
  return ['--ignore-user-config', '--ignore-rules', '--config', '--sandbox', '--cd', '--skip-git-repo-check']
}

// All required flags are listed under `codex exec --help`; the top-level help is read too for older layouts.
export function helpArgs() {
  return [['--help'], ['exec', '--help']]
}

// `maxMinutes` is enforced by the caller's timer, not by a CLI flag.
export function buildInvocation({ prompt, cwd, env = process.env, toolPath } = {}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('codex adapter: prompt is required')
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) throw new Error('codex adapter: cwd must be an absolute path')
  return {
    cmd: toolPath || tool,
    args: [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '-c', 'approval_policy="never"',
      '-c', 'approvals_reviewer="user"',
      '--sandbox', 'workspace-write',
      '--cd', cwd,
      '--skip-git-repo-check',
      '--', prompt,
    ],
    env: buildChildEnv(env),
    cwd,
  }
}

function classify(message) {
  if (/not logged in|codex login|\b401\b|unauthori[sz]ed|token (has )?expired|please (log ?in|sign ?in)/i.test(message)) {
    return { code: 'not_signed_in', message: 'codex is not signed in or its sign-in expired.' }
  }
  if (/usage limit|limit reached|rate limit|hit your limit|quota/i.test(message)) {
    return { code: 'quota_exhausted', message: 'codex reported that the usage limit is reached.' }
  }
  return null
}

export function parseResult({ code, stdout = '', stderr = '' }) {
  const out = stdout.trim()
  const err = stderr.trim()

  if (code === null || code === undefined) {
    return { status: 'failed', needsInput: false, failureReason: { code: 'interrupted', message: 'The process was stopped before it finished.' }, text: out }
  }
  if (code === 0) {
    if (out.startsWith(NEEDS_INPUT_MARKER)) {
      return { status: 'needs_input', needsInput: true, failureReason: null, text: out.slice(NEEDS_INPUT_MARKER.length).trim() }
    }
    return { status: 'completed', needsInput: false, failureReason: null, text: out }
  }
  return { status: 'failed', needsInput: false, failureReason: classify(`${out}\n${err}`), text: out || err }
}
