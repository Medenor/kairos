// Test fixture: a fake `claude` / `codex` terminal tool (T040).
//
// Tests call `writeFakeCli(dir, name, behavior)`, which writes a JSON behavior file and an executable
// shell wrapper `<dir>/<name>` that runs this script with that behavior. The wrapper carries the behavior
// path itself (not through the environment), so it still works when the runner hands the child an
// allowlisted environment. Every invocation appends one JSON line `{argv, cwd, env, pid}` to the record
// file (the `FAKE_CLI_*` variables are left out so tests can assert on the exact child environment).
//
// Behavior fields (all optional):
//   stdout, stderr   text printed by a normal run
//   exitCode         exit code of a normal run (default 0)
//   sleepMs          wait before printing and exiting (interruptible by SIGTERM unless ignoreSigterm)
//   ignoreSigterm    keep running after SIGTERM (the runner must escalate to SIGKILL)
//   writeFiles       { relativePath: content } written under the cwd before exiting (simulates edits)
//   helpText         output of any invocation with `--help` (default: lists no flags)
//   versionText      output of `--version`
//   auth             { mode: 'subscription' | 'api_key' | 'unparseable' | 'logged_out' | 'fail', exitCode }
//                    for `auth status [--json]` (claude style) and `login status` (codex style)

import { appendFileSync, chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)

/** Output of the fake auth status commands for each mode, per tool style. */
export function authStatusOutput(style, mode) {
  if (mode === 'unparseable') return { stdout: '<<not a status report>>\n', exitCode: 0 }
  if (mode === 'fail') return { stdout: '', stderr: 'status unavailable\n', exitCode: 1 }
  if (style === 'claude') {
    if (mode === 'logged_out') {
      return { stdout: `${JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' })}\n`, exitCode: 1 }
    }
    const authMethod = mode === 'api_key' ? 'api_key' : 'claude.ai'
    return { stdout: `${JSON.stringify({ loggedIn: true, authMethod, apiProvider: 'firstParty' })}\n`, exitCode: 0 }
  }
  // codex
  if (mode === 'logged_out') return { stdout: 'Not logged in\n', exitCode: 1 }
  return { stdout: mode === 'api_key' ? 'Logged in using an API key\n' : 'Logged in using ChatGPT\n', exitCode: 0 }
}

/**
 * Create a fake tool in `dir`. Returns `{ path, recordFile, configFile, calls(), setBehavior(patch) }`.
 * `calls()` reads the recorded invocations; `setBehavior` rewrites the behavior file (merging the patch).
 */
export function writeFakeCli(dir, name, behavior = {}) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  const configFile = join(dir, `${name}.behavior.json`)
  const recordFile = join(dir, `${name}.calls.jsonl`)
  let current = { ...behavior, recordFile }
  writeFileSync(configFile, JSON.stringify(current))
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`
  writeFileSync(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(SELF)} --fake-config ${quote(configFile)} -- "$@"\n`)
  chmodSync(path, 0o755)
  return {
    path,
    recordFile,
    configFile,
    calls() {
      try {
        return readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      } catch {
        return []
      }
    },
    setBehavior(patch) {
      current = { ...current, ...patch, recordFile }
      writeFileSync(configFile, JSON.stringify(current))
    },
  }
}

function printAndExit(stdout, stderr, exitCode) {
  const done = () => process.exit(exitCode)
  if (stderr) process.stderr.write(stderr)
  if (stdout) process.stdout.write(stdout, done)
  else done()
}

function main(argv) {
  const configIndex = argv.indexOf('--fake-config')
  const separator = argv.indexOf('--')
  const behavior = JSON.parse(readFileSync(argv[configIndex + 1], 'utf8'))
  const args = argv.slice(separator + 1)

  if (behavior.recordFile) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FAKE_CLI_')))
    appendFileSync(behavior.recordFile, `${JSON.stringify({ argv: args, cwd: process.cwd(), env, pid: process.pid })}\n`)
  }

  const style = args[0] === 'login' ? 'codex' : 'claude'
  if ((args[0] === 'auth' && args[1] === 'status') || (args[0] === 'login' && args[1] === 'status')) {
    const mode = behavior.auth?.mode ?? 'subscription'
    const out = authStatusOutput(style, mode)
    printAndExit(out.stdout, out.stderr, behavior.auth?.exitCode ?? out.exitCode)
    return
  }
  if (args.includes('--help')) {
    printAndExit(behavior.helpText ?? 'Usage: fake-cli [options]\n', '', 0)
    return
  }
  if (args.includes('--version')) {
    printAndExit(behavior.versionText ?? 'fake-cli 1.0.0\n', '', 0)
    return
  }

  if (behavior.ignoreSigterm) process.on('SIGTERM', () => {})
  const finish = () => {
    for (const [relative, content] of Object.entries(behavior.writeFiles ?? {})) {
      const target = join(process.cwd(), relative)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
    }
    printAndExit(behavior.stdout ?? '', behavior.stderr ?? '', behavior.exitCode ?? 0)
  }
  if (behavior.sleepMs > 0) setTimeout(finish, behavior.sleepMs)
  else finish()
}

const entry = process.argv[1]
let isMain = false
try {
  isMain = Boolean(entry) && import.meta.url === pathToFileURL(realpathSync(entry)).href
} catch {
  isMain = false
}
if (isMain) main(process.argv.slice(2))
