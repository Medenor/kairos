# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A solo power user who holds several AI subscriptions and pay-as-you-go balances (weekly quotas, 5-hour slots, monthly request caps, credit balances). They open the dashboard just before starting a task to decide which provider to use, and update quota readings as they go. Typical setup is a home network with a few devices, optionally sharing state through the LAN backend.

## Product Purpose

Kairos is a quota-aware routing dashboard. It tracks the quotas of the providers the user declares and recommends which one to use right now for a given task type. It exists so the user stops defaulting to their best tool for everything and hitting limits at the wrong moment. Success is a correct, justified recommendation in a glance.

## Positioning

Explainable routing: every recommendation comes with a `reason`, computed by deterministic rules from only what the user declared (fit per task, quota pressure, reset timing). Kairos ships no provider list, and data stays local by default. A generic quota tracker could not truthfully claim traceable, per-task routing advice.

## Operating Context

- Static React frontend that works fully offline, with state in `localStorage`.
- Optional shared backend (Node `http` + SQLite) for LAN-wide consistency, migration and backups; built for a trusted home network.
- Optional local surplus runner CLI that can start approved ideas on a subscription-signed-in `claude` or `codex` CLI when quota would otherwise expire unused.
- Delivered as a static build or an Nginx container.

## Capabilities and Constraints

- User-declared providers (name, one to eight quotas, reset schedule, cost, colour, flags, note, fit per five task types); edit, duplicate, reorder, delete.
- Three quota input modes per quota: consumed %, remaining %, currency balance with a low-balance level.
- Reset tracking with days-until-reset and overdue status; weekly history (Monday start, 52 weeks, explicit gaps, never zero for missing data).
- Idea queue, surplus suggestions with the rules behind them, reading age (12 h) gating surplus, reset-cycle history.
- Dark mode exists.
- Constraints: runtime dependencies stay at React + React DOM; CSS Modules; every recommendation needs a reason; no provider is ever named in routing, provider, surplus or runner code; AGPL-3.0-or-later.

## Brand Commitments

Name "Kairos" with a logo at `public/logo.webp` and `public/logo_squared.webp`. No other voice or identity commitments were stated.

## Evidence on Hand

Real feature specs under `specs/`, project docs under `docs/`, and a CHANGELOG. No testimonials, customer logos, benchmarks or usage numbers exist; future work must not invent them.

## Product Principles

1. Routing value first: the recommendation is the product; everything else serves it.
2. Explain every decision: a recommendation without its reason is a defect.
3. Never imply data you do not have: gaps, stale readings and overdue resets are shown as such, not as zero or fresh.
4. Local by default, shared by choice: it must work offline and with no provider preloaded.
5. Quiet by default: the user declares the providers, so the interface adds no assumed vendor knowledge.

## Accessibility & Inclusion

No formal standard required. Follow good practice: keyboard operability, sufficient contrast in light and dark, reduced-motion respect.
