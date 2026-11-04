# Contract: shared records for dynamic-providers

No backend route or schema change. Everything uses the endpoints of [feature 002](../../002-shared-state-backend/contracts/shared-state-api.openapi.yaml): `GET/POST /workspaces/:id/records`, `PUT /workspaces/:id/records/:recordId`, `GET /workspaces/:id/sync/pull`. Payload shapes are in [data-model.md](../data-model.md).

## New logical keys (`record_type: "routing_config"`)

| Logical key | Writer | Update rule | Notes |
| --- | --- | --- | --- |
| `provider:{providerId}` | Browser | `POST` on creation; `PUT` with `expected_version` on edit and on deletion | Active definition, or a tombstone (`status: "removed"`) after deletion. Never HTTP-deleted, so a stale device cannot resurrect it |
| `catalogue-order` | Browser | `PUT` with `expected_version`; last writer wins after a 409 refresh | Display order only |

## Changed keys

| Logical key | Change |
| --- | --- |
| `surplus-policy` | payload schema v2 (`providers` map, optional `legacy`); a v1 payload is read and rewritten as v2 on the next policy write |
| `cycle:{id}:{resetDate}` | `{id}` is a provider id; legacy ids stay readable |
| `run:{id}`, `idea:{id}` | `serviceId` holds a provider id; run and cycle payloads gain optional `providerName` |
| `{providerId}:{quotaId}` and metadata keys | `quota_state` records, mechanism unchanged |

Weekly snapshots keep `weekly-history:{weekKey}` with the v2 payload.

## Compatibility with devices on the previous build

- `applySurplusRecords` ignores unknown `routing_config` keys (`storage.js`), so `provider:*` and `catalogue-order` are inert on an old build.
- An old build still writes `surplus-policy` v1 and `quota_state` for its fixed ids. A v2 build reading a v1 policy takes its global fields and ignores `services`; reading `quota_state` for legacy ids is a no-op (nothing iterates them). Mixed fleets are therefore safe but not meaningful: the old build shows its fixed list, the new build shows the declared one.

## Trust rules (FR-035)

- A `provider:*` record is **data, never authority**. The runner uses it for names, quotas, schedule and tool *for evaluation only*, and only after `validateProviderRecord` accepts it.
- No field of a provider record, of `surplus-policy` or of an idea authorises a run. Authorisation needs the local runner allowance pinned to the provider id and tool, the local idea approval, the lease, the control record and the STOP file (see [runner-allowance.md](runner-allowance.md)).
- A record that fails validation is never applied, never replaces a valid one, and is listed with its errors in the dashboard.

## Client behaviour

- Local-first, same as 006: `kairos:providers` is written first; shared mode marks the key dirty, flushes after the debounce, pulls incrementally and diffs a periodic full pull to find remote removals.
- A 409 on `provider:{id}`: refetch; if the remote is a tombstone the edit is dropped and the user is told it was removed elsewhere; otherwise the user sees what changed and reapplies. Nothing is overwritten silently.
- Duplicate names: two active providers with the same normalised name (created offline on two devices) are both kept; `nameConflicts` flags the later one and the UI asks the user to rename it. Nothing is renamed or removed automatically.
- Late arrival: quota readings or snapshots that reference a provider whose definition has not synced are kept and rendered from their own data; the provider appears live once the definition arrives, with its quotas marked unread until readings arrive (research D4).

## Backend tests (additive)

`backend/tests/contract/provider-records.contract.test.js`: create, stale-version 409, tombstone `PUT`, `since` listing and backup/restore round trip for `provider:*` and `catalogue-order`, asserting `quota_state`, `snapshot` and surplus records in the same workspace are untouched.
