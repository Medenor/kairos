# Quickstart: validating dynamic-providers

Run after implementation. Details of shapes and rules: [data-model.md](data-model.md), [contracts/](contracts/).

## Prerequisites

- Node.js 26 or newer, `sqlite3` on `PATH` (backend tests), dependencies installed (`npm install`).
- A clean browser profile (or clear `localStorage` for the dev origin) to see the empty state.

## 1. Automated checks

```bash
npm run lint && npm test && npm run build
npm run lint:paths
```

Expected: all green. Notable suites: `src/providers/*.test.js` (reducers, validation, tie-break, records), `src/routing/*.test.js` (generic rules, determinism, shuffled-input independence, no-provider-literal guard, reference before/after), weekly-history and surplus suites updated for provider ids, `runner/loop.guardrails.test.js` (allowance), `backend/tests/contract/provider-records.contract.test.js`.

## 2. Local-only walkthrough (US1, US2, US3, US6)

```bash
npm run dev
```

1. Open `http://localhost:5173` with no stored data: no provider card, an empty state inviting a first provider; the recommendation box says a provider must be added (US1-1, edge case).
2. Add three providers: a weekly subscription with two percentage quotas, a monthly one with one quota, a pay-as-you-go balance with a currency quota. Give each a fit level for "Heavy coding" (strong, acceptable, weak). Try an empty name, a duplicate name differing by case, no quota and a value of 140: each is refused next to its field (US1-4).
3. Reload: all three are present, unchanged (US1-5). Confirm no former provider (Claude, ChatGPT, Copilot, OpenRouter, Kilocode) appears unless you created it.
4. Select "Heavy coding": the primary, its reason (fit, pressure, reset) and alternatives appear. Raise the primary's quota to 90 %: the recommendation moves as the rules dictate (US2). Set two providers equal with different reset dates: the sooner reset wins and the reason says so.
5. Delete the primary: the dialog names it and says what is removed and kept; cancel leaves it unchanged; confirm removes it and the recommendation updates immediately (US3-4/5).
6. Change a quota's type: the form requires a new value. Remove all but one quota: the last cannot be removed.
7. Duplicate a provider, rename the copy, drag the order: the copy has its own values and no surplus, and the order survives a reload (US6).

## 3. Weekly history (US5-1 to 5-4)

1. Open weekly history after the steps above: one series per provider.
2. Rename a provider and add a quota: the series continues under the new name; earlier weeks keep their values.
3. Delete a provider: its series stays, marked removed, current week included.
4. A provider created today shows "no history recorded" for earlier weeks, not zero.

## 4. Shared mode and backup (US4)

```bash
npm run dev            # frontend
# in another terminal, per docs/DEVELOPMENT.md: start the backend with a workspace
```

1. Turn shared mode on, add a provider, open a second browser profile on the same workspace: the same provider appears after sync.
2. Edit the same provider in both profiles: the second save reports a conflict and overwrites nothing. Delete in one while editing in the other: the deleted provider does not come back.
3. Create a backup, delete a provider, restore: the provider, its readings and its history return together.
4. Export local data: the file contains `provider:*` and `catalogue-order` records.

## 5. Surplus and runner (US5-5 to 5-9)

1. Create a provider with a weekly schedule, two percentage quotas, tool `claude`, designate the weekly and session quotas. Without those, the form lists what is missing and no surplus setting is offered.
2. Replay the 006 scenario: weekly 60 % remaining, reset in 2 days, readings confirmed 2 h ago, session 60 % remaining, one approved medium idea. Expect a suggestion with the same rule outcomes as before. Confirm the readings 20 h old, or reset today: no suggestion, reason stated.
3. Runner (fake CLI per `runner/README.md`): `npm run runner -- allow <name>` confirms and pins the tool; without it, automatic runs never start even if the shared policy says auto.
4. Write a provider record directly into the store (curl `POST /records`) with surplus on: it is not allowed on the runner and no run starts. Switch an allowed provider's tool in the store: tick reports `tool_changed`.
5. Start a run, then delete its provider: the dialog warns first; afterwards the run stops, partial output is kept, the idea is retriable and the run record still names the provider, shown as removed.

## 6. Legacy data

With a profile that holds data from the previous build (fixed five providers, history, runs): the dashboard is empty; weekly history, run records and cycle records still open, labelled as removed providers from the previous version; a newly created provider named "Claude" starts empty and inherits nothing.
