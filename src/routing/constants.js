// Constants of the generic routing rules (research D5, D7, D8). `ROUTING_RULESET_VERSION` versions the
// recommendation rules in src/routing/engine.js. It is NOT the surplus rule-set version
// (`RULESET_VERSION` in src/surplus/constants.js), which versions a different set of rules.
// Version 1 was the fixed-provider rule table, which lives on only as a test fixture.

export const ROUTING_RULESET_VERSION = 2

// Declared fit of a provider for a task. An undeclared task counts as `none`.
export const FIT_SCORE = Object.freeze({ strong: 3, acceptable: 2, weak: 1, none: 0 })

// Pressure bands (consumed %): below BAND_WARN no penalty, from BAND_WARN to BAND_CRIT one point,
// from BAND_CRIT up to (excluding) 100 two points. These are the thresholds of the former rules.
export const BAND_WARN = 60
export const BAND_CRIT = 85

// Fixed pressure buckets replace the former pairwise "within 15 points" test, which was not transitive.
export const BUCKET_WIDTH = 15

export const MAX_ALTERNATIVES = 3

// A reset this close (in days) adds the "spend it now" note to the reason.
export const RESET_NOTE_DAYS = 2
