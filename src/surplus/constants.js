// Shared constants for the surplus-runner feature (pure ES module, no browser or Node APIs).

// Version of the SURPLUS evaluation rules (src/surplus/evaluation.js); it is recorded in Run.decisionInputs.
// 2 (feature 007): the selection order and its explanation changed (ties broken by name, not display
// order); rules R1 to R7 keep their meaning. It is not ROUTING_RULESET_VERSION (src/routing/constants.js),
// which versions the recommendation rules.
export const RULESET_VERSION = 2

export const STATUS = Object.freeze({
  WAITING: 'waiting',
  LAUNCHED_MANUALLY: 'launched_manually',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_INPUT: 'needs_input',
  ARCHIVED: 'archived',
})

export const PRIORITY = Object.freeze({
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
})

export const SIZE = Object.freeze({
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
})

// Terminal tools the runner has adapters for. They name tools, never providers (feature 007).
export { SUPPORTED_TOOLS } from '../providers/surplusProfile.js'

// Documented defaults (research D13). Units are part of each name.
export const DEFAULTS = Object.freeze({
  RESERVE_PCT: 20,
  WINDOW_DAYS: 2,
  COST_SMALL_PCT: 3,
  COST_MEDIUM_PCT: 8,
  COST_LARGE_PCT: 15,
  SESSION_MIN_ROOM_PCT: 30,
  FRESHNESS_HOURS: 12,
  SESSION_MAX_AGE_HOURS: 5,
  MAX_RUN_MINUTES: 60,
  EVAL_INTERVAL_MINUTES: 15,
  STOP_WATCHER_SECONDS: 5,
  QUOTA_WATCHER_SECONDS: 60,
  CONTEXT_LIMIT_CHARS: 10000,
  COPY_LIMIT_BYTES: 1024 * 1024 * 1024,
  OUTPUT_CAP_BYTES: 256 * 1024,
})
