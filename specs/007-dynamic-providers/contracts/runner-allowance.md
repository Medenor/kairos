# Contract: runner provider allowance

Extends [006 runner-cli.md](../../006-surplus-runner/contracts/runner-cli.md). The runner stays a client of the shared-state API with no listening socket; the backend is unchanged.

## Config `~/.kairos-runner/config.json` v2

```
allowProviders: [{ providerId, tool, name, allowedAt }]   // written only by `allow`
legacyAllowServices?: [...]                                // v1 allowServices, moved verbatim, never read
```

A v1 file loads: `allowServices` moves to `legacyAllowServices`, `allowProviders` is `[]` (no provider is allowed until the user allows it again). Unknown keys continue to be dropped.

## Commands

| Command | Behaviour |
| --- | --- |
| `allow <name-or-id>` | Pulls the catalogue, lists providers with an eligible surplus profile (name, tool, weekly and session quota labels). Resolves the argument (id, or unique case-folded name); on ambiguity or no match, prints the candidates and exits non-zero. Asks for explicit confirmation, then stores `{providerId, tool, name, allowedAt}` |
| `disallow <name-or-id>` | Removes the entry; also works for an id no longer in the catalogue |
| `config show` / `status` | Lists allowed providers with current catalogue state: `ok`, `tool changed (pinned X, now Y)`, `removed`, `not eligible (reasons)` |
| `config set allowServices ...` | Removed; prints that providers are now allowed with `allow` |

## Guard order in `guardService(providerId, policy)`

Evaluated for the provider of the selected idea; the first failure is the tick's reason.

1. `policy.providers[id].autoRunEnabled === true` (`auto_run_disabled`)
2. `disclosuresAckAt` set (`disclosures_missing`)
3. `allowProviders` contains `id` (`service_not_allowed`, detail names the provider)
4. catalogue record valid, active, surplus profile eligible (`provider_not_eligible`, detail lists problems)
5. catalogue `surplus.tool` equals the pinned `tool` (`tool_changed`)
6. adapter exists for the tool; Codex opt-in `allowCodexAuto`; preflight (unchanged)

The rest of the tick is unchanged: STOP file, lease, global control, `evaluateSurplus({mode:'auto'})`, folder checks, local idea approval by content hash, claim by versioned `PUT`. Steps 1 and 2 come from the shared store and can only *restrict*; steps 3 and 5 are local and cannot be set by any store write.

## Watcher change (FR-037)

The 5-second stop watcher, after its incremental pull, checks that the active run's provider still satisfies steps 1, 4 and 5 and that its record is not a tombstone. If not, it stops the run exactly as the STOP file does: process terminated, partial output kept, idea returned to `waiting`, run record finalised with failure code `stopped_by_user` and a detail naming the cause ("provider removed", "surplus turned off", "tool changed"). The record keeps `providerName` as captured when the run started.

## Journal and status

`serviceId` in the journal, `status.json` and run records holds the provider id; display strings use the captured `providerName`. No journal format change.

## Tests

`runner/loop.guardrails.test.js` gains: provider written to the store but not allowed; allowed provider whose tool is switched in the store; allowed provider removed; policy flipped to auto by a store write without local allowance; deletion of the provider during a run (partial output kept, idea retriable, record names the provider); legacy `allowServices` file loads with nothing allowed.
