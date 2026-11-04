// Append-only run journal for restart idempotence (T051, research D8).
// `<baseDir>/journal.jsonl` holds one JSON object per line (mode 0600). A run writes a `start` entry before
// the child is spawned and an `end` entry after it exits; a `start` without a matching `end` means the runner
// died mid-run. Entries are never rewritten or removed. The journal holds no output, prompts or environment.

import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { ensureDir, runnerPaths } from './config.js'

export const JOURNAL_TYPES = Object.freeze(['start', 'end', 'evaluation-skipped'])

function requireText(entry, field) {
  if (typeof entry[field] !== 'string' || entry[field] === '') throw new TypeError(`journal entry needs ${field}`)
}

function append(baseDir, entry) {
  const file = runnerPaths(baseDir).journal
  ensureDir(baseDir)
  const fresh = !existsSync(file)
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  if (fresh) chmodSync(file, 0o600)
  return entry
}

/**
 * Write the `start` entry of a run (before spawning the tool).
 * `entry`: { runId, ideaId, serviceId, at (ISO), tool?, cwd?, pid? }. Returns the stored entry.
 */
export function appendStart(baseDir, entry) {
  for (const field of ['runId', 'ideaId', 'serviceId', 'at']) requireText(entry, field)
  const { runId, ideaId, serviceId, at, tool = null, cwd = null, pid = null } = entry
  return append(baseDir, { type: 'start', runId, ideaId, serviceId, at, tool, cwd, pid })
}

/**
 * Write the `end` entry of a run (after the child exited and the records were finalised).
 * `entry`: { runId, status ('completed' | 'failed' | 'needs_input' | 'interrupted'), at (ISO), failureReason? }.
 */
export function appendEnd(baseDir, entry) {
  for (const field of ['runId', 'status', 'at']) requireText(entry, field)
  const { runId, status, at, failureReason = null } = entry
  return append(baseDir, { type: 'end', runId, status, at, failureReason })
}

/**
 * Record that a tick selected nothing to run because a local guardrail failed (contract tick step 6).
 * `entry`: { at (ISO), reason (preflight or guardrail code), ideaId?, serviceId? }.
 */
export function appendEvaluationSkipped(baseDir, entry) {
  for (const field of ['at', 'reason']) requireText(entry, field)
  const { at, reason, ideaId = null, serviceId = null } = entry
  return append(baseDir, { type: 'evaluation-skipped', at, reason, ideaId, serviceId })
}

/** All entries in file order. Blank lines and lines that are not valid journal JSON (for example a write cut short by a crash) are skipped. */
export function readJournal(baseDir) {
  const file = runnerPaths(baseDir).journal
  if (!existsSync(file)) return []
  const entries = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry === 'object' && JOURNAL_TYPES.includes(entry.type)) entries.push(entry)
    } catch {
      // ignore a truncated or corrupt line
    }
  }
  return entries
}

/** The `start` entries that have no `end` entry for the same runId, oldest first. */
export function unfinishedRuns(baseDir) {
  const entries = readJournal(baseDir)
  const ended = new Set(entries.filter((e) => e.type === 'end').map((e) => e.runId))
  return entries.filter((e) => e.type === 'start' && !ended.has(e.runId))
}
