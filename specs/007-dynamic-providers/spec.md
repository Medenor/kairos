# Feature Specification: dynamic-providers

**Feature Branch**: `007-dynamic-providers`  
**Created**: 2026-11-01  
**Status**: Draft  
**Input**: User description: "being able to add, delete or modify providers so that the app is dynamic, not fixed or code static"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build My Own Provider List From Scratch (Priority: P1)

As a user, I want to declare the AI providers I actually use (name, what I pay, how their quota works, when it resets) from within the app, starting from an empty list, so that Kairos tracks my real subscriptions instead of a fixed set decided by the developer.

**Why this priority**: This is the core of the feature. Without it, any change of subscription requires a code change. It is also the new entry point of the app, since nothing is pre-filled.

**Independent Test**: Start with no stored data. Add three providers of different kinds (a weekly-reset subscription with two quotas, a monthly-reset subscription with one quota, a pay-as-you-go balance). Reload the app and confirm all three appear with their quotas, reset information and costs exactly as entered, and that no provider the user did not create is present.

**Acceptance Scenarios**:

1. **Given** the app is opened with no stored data, **When** the dashboard loads, **Then** no provider is shown, and an explanatory empty state invites the user to add a first provider.
2. **Given** the add-provider form is open, **When** the user enters a name, at least one quota (with a label, a quota type among consumed percentage, remaining percentage or currency balance, and a current value) and a reset schedule, **Then** the provider is created and appears on the dashboard immediately, with its quotas editable like any other.
3. **Given** the add-provider form, **When** the user optionally enters a subscription cost, a colour, descriptive flags and a free note, **Then** these are saved and shown on the provider's card.
4. **Given** the add-provider form, **When** the user leaves the name empty, uses a name already taken by another provider, declares no quota, or enters a value outside the allowed range for the chosen quota type, **Then** the provider is not created and each problem is explained next to the relevant field.
5. **Given** a provider just created, **When** the user reloads the app, **Then** the provider is still there and unchanged.

---

### User Story 2 - Get Recommendations Based On My Own Providers (Priority: P1)

As a user, I want the "which AI should I use right now" recommendation to work with whatever providers I declared, so that adding or removing a provider immediately changes the advice I get, with a clear reason.

**Why this priority**: Declaring providers is only valuable if routing follows them. This is the product's core promise, and it must not remain tied to a fixed set of named services.

**Independent Test**: Declare two providers and give each a fit level for a task. Select that task and verify the recommendation, its reason and the alternative. Change one provider's quota level and verify the recommendation changes as the rules dictate. Add a third provider and verify it is considered. Remove the recommended provider and verify the next best is proposed.

**Acceptance Scenarios**:

1. **Given** at least one provider with a fit level for the selected task and available quota, **When** the user selects a task, **Then** the app proposes a provider with a concise reason derived from that provider's quota state, its fit for the task and its reset timing, and lists alternatives.
2. **Given** two providers equally suited to a task, **When** their quota pressures are comparable, **Then** the one whose quota resets sooner is proposed, and the reason says so (the existing reset-aware behaviour is preserved).
3. **Given** a provider whose quota is exhausted, **When** the user selects a task that this quota gates, **Then** that provider is not proposed for that task, and the reason explains why; tasks that the exhausted quota does not gate remain eligible for that provider.
4. **Given** a provider is added, edited or removed, **When** the user next selects a task, **Then** the recommendation reflects the change without reinstalling, redeploying or reloading the app by hand.
5. **Given** no provider exists, or none is eligible for the selected task, **When** the user selects a task, **Then** the app says so and states why, rather than showing an empty or misleading result.
6. **Given** identical providers, quota values, reset dates and task, **When** the recommendation is computed repeatedly, **Then** the outcome and the reason are identical every time.

---

### User Story 3 - Modify Or Delete A Provider (Priority: P2)

As a user, I want to change a provider's details when my subscription changes (new price, new quota, different reset cycle, renamed plan) and to delete a provider I no longer use, so that the dashboard always matches reality.

**Why this priority**: Subscriptions change often. Without edit and delete, the list becomes stale and the user would have to recreate providers. It builds on creation, hence P2.

**Independent Test**: Take an existing provider, rename it, change its cost, add a quota, remove another quota, change the reset schedule, and verify that each change is reflected on the card, in recommendations and after reload. Then delete it and verify it disappears everywhere.

**Acceptance Scenarios**:

1. **Given** an existing provider, **When** the user edits its name, cost, colour, flags, note, reset schedule, task fits or quota definitions, **Then** the changes apply immediately and persist after a reload.
2. **Given** a provider with several quotas, **When** the user adds a quota or removes one (while at least one remains), **Then** the dashboard and recommendations use the updated set of quotas.
3. **Given** a quota with a current value, **When** the user changes its type (for example from consumed percentage to remaining percentage), **Then** the app asks the user to confirm or re-enter the value, and never silently reinterprets the old number.
4. **Given** the user chooses to delete a provider, **When** the confirmation is shown, **Then** it names the provider, states what will be removed (its quotas, reset dates and history) and offers cancel; only after explicit confirmation is the provider removed.
5. **Given** a provider is deleted, **When** the user views the dashboard and requests recommendations, **Then** the provider no longer appears anywhere and is never proposed.
6. **Given** the user cancels an edit or a deletion, **When** they return to the dashboard, **Then** the provider is exactly as before.

---

### User Story 4 - Keep My Provider List Safe Across Devices And Backups (Priority: P2)

As a user, I want my provider definitions to be stored, shared and backed up exactly like my quota data, so that I never have to declare them again on another device or after a restore.

**Why this priority**: Provider definitions become the foundation of all other data. Losing them would make every quota value meaningless.

**Independent Test**: Declare providers with shared mode on, open the app on a second device and verify the same providers appear. Create a backup, delete a provider, restore the backup and verify the provider returns. With shared mode off, verify the list persists locally across reloads.

**Acceptance Scenarios**:

1. **Given** shared mode is off, **When** the user reloads or reopens the app on the same device, **Then** the provider list is unchanged.
2. **Given** shared mode is on, **When** a provider is added, edited or deleted on one device, **Then** another device shows the same list after it syncs.
3. **Given** two devices edit the same provider concurrently, **When** the second save happens, **Then** the user is told about the conflict and no change is silently overwritten.
4. **Given** a backup exists, **When** the user restores it, **Then** the provider definitions and their quota data are restored together and consistently.
5. **Given** the user exports local data, **When** the export is produced, **Then** it includes the provider definitions.

---

### User Story 5 - Set Up Providers Faster (Priority: P3)

As a user, I want to duplicate an existing provider and to reorder my providers, so that declaring similar providers or arranging the dashboard takes little effort.

**Why this priority**: A convenience on top of the core flows. Valuable once the user manages more than a few providers, but nothing depends on it.

**Independent Test**: Duplicate a provider, verify the copy carries its settings with a distinct name and independent data, then reorder providers and verify the order persists after reload.

**Acceptance Scenarios**:

1. **Given** an existing provider, **When** the user duplicates it, **Then** a new provider is created with the same settings and a distinct, editable name, and its quota values and reset dates are independent of the original.
2. **Given** several providers, **When** the user reorders them, **Then** the dashboard shows them in that order after a reload, without altering any recommendation outcome.

---

### Edge Cases

- Zero providers: the dashboard shows the empty state, and recommendations explain that a provider must be added first.
- Exactly one provider: it is recommended when eligible, with no alternatives; when blocked, the app says nothing is available.
- Every provider is blocked for the selected task: the app says so, and shows when the soonest reset happens if reset dates are known.
- A provider has no declared fit for a given task: it is treated as not suitable for that task, and this default is visible to the user.
- Two providers share a name, differing only by case or surrounding spaces: treated as the same name and refused.
- A quota value is outside its allowed range, not a number, or a currency balance is negative: refused with an explanation.
- A reset schedule is changed (for example weekly to monthly) while a reset date is already recorded: the user is asked to confirm or update the next reset date, and an inconsistent date is flagged rather than trusted.
- A pay-as-you-go provider has no reset: it is never reported as "overdue".
- A provider is deleted while it is the one currently recommended: the recommendation is recomputed immediately.
- The last quota of a provider cannot be removed; the user must delete the provider instead.
- Two devices delete and edit the same provider at the same time: the user is informed, and the deleted provider is not silently resurrected.
- Data stored by the previous, fixed-provider version of the app is present on the device or in the shared store: it is not imported, not displayed and not deleted, and is never mistaken for a user-defined provider.
- A restored backup or an imported file contains invalid or unknown provider data: it is rejected or sanitised with a clear message, and the current list is left intact.
- A large number of providers (at least 20): the dashboard stays usable and recommendations stay immediate.
- A provider is renamed while other features (for example surplus ideas or history) refer to it: the references follow the provider, not the old name.
- A provider referenced by other features is deleted: those features keep their records, show the provider as removed, and never fail.

## Requirements *(mandatory)*

### Functional Requirements

**Provider management**

- **FR-001**: The app MUST start with no providers and MUST NOT ship, pre-fill or recreate any predefined provider.
- **FR-002**: Users MUST be able to add a provider with: a name (required, unique ignoring case and surrounding spaces), at least one quota (required), a reset schedule (required), and optionally a subscription cost with its currency, a colour, descriptive flags and a free note.
- **FR-003**: Users MUST be able to edit every attribute of a provider after creation, and the change MUST take effect immediately in the dashboard and in recommendations.
- **FR-004**: Users MUST be able to delete a provider after an explicit confirmation that states what will be removed. A provider MUST never be deleted without that confirmation.
- **FR-005**: Each provider MUST own one or more quotas. Each quota MUST have a label, a type among the three explicit input modes (consumed percentage, remaining percentage, currency balance with a currency symbol) and a current value. Users MUST be able to add, edit and remove quotas of an existing provider, but never remove the last one.
- **FR-006**: Quota values MUST be validated against their type (percentages within 0–100, currency balances not negative), and invalid input MUST be refused with an explanation next to the field.
- **FR-007**: Changing a quota's type MUST require the user to confirm or re-enter its value; the system MUST NOT silently reinterpret the stored number.
- **FR-008**: Users MUST be able to declare a reset schedule per provider among: weekly, monthly, a custom cycle in days, or none (pay-as-you-go). The existing per-provider reset date tracking MUST keep working for every schedule that has a cycle.
- **FR-009**: The system MUST support at least 20 providers without degradation of dashboard use or recommendation speed.
- **FR-010**: Users MUST be able to duplicate a provider and to reorder providers; the order MUST persist and MUST NOT influence any recommendation outcome.

**Recommendations**

- **FR-011**: Recommendations MUST be computed solely from user-declared provider data and the selected task. The rules MUST NOT reference any specific provider by name or identifier.
- **FR-012**: For each provider, users MUST be able to declare how well it fits each task of the fixed task list (at least: strong fit, acceptable fit, weak fit, not suitable), and, for each quota, which tasks it gates (default: all tasks). A task with no declared fit MUST be treated as not suitable.
- **FR-013**: Recommendation rules MUST derive a provider's eligibility and rank for a task from: its fit for the task, the state of the quotas that gate that task (normalised across the three quota types so that they are comparable), and its reset timing.
- **FR-014**: The rules MUST be deterministic and version-controlled: identical inputs MUST always produce the same primary provider, alternatives and reason, and the order in which providers were created or displayed MUST NOT change the outcome (ties are broken by an explicit, documented criterion).
- **FR-015**: The existing reset-aware behaviour MUST be preserved in generic form: when two eligible providers have comparable quota pressure, the one resetting sooner MUST be preferred, and a due or overdue reset MUST be noted in the reason.
- **FR-016**: Every recommendation MUST include a concise reason stating the inputs that drove it (fit, quota state, reset timing), the primary provider and the alternatives. When no provider is eligible, the app MUST state that and why.
- **FR-017**: Adding, editing or deleting a provider MUST update the recommendation the next time it is shown, and an already displayed recommendation MUST NOT keep referring to a deleted provider.
- **FR-018**: The task list MUST remain unchanged by this feature; tasks are not user-editable.

**Persistence, sharing and safety**

- **FR-019**: Provider definitions MUST be stored with the same scope, consistency and conflict handling as the existing quota state: local-first, with shared persistence across devices when shared mode is on.
- **FR-020**: Provider definitions MUST be part of backups, restores and local exports, and a restore MUST bring definitions and quota data back consistently.
- **FR-021**: Every edit MUST be atomic from the user's point of view: a refused or cancelled edit MUST leave the provider exactly as it was, and an interrupted save MUST never leave a half-defined provider.
- **FR-022**: Data held by the previous fixed-provider version MUST NOT be imported, displayed or modified. The user is starting from an empty base.
- **FR-023**: Other features that refer to a provider MUST identify it by a stable identity that survives renames, and MUST keep working, with the provider shown as removed, when the provider is deleted.
- **FR-024**: Anything provider-specific that other features need (for example per-provider settings of the surplus runner) MUST be attached to the user's provider record and MUST NOT rely on a hard-coded provider name or identifier.
- **FR-025**: The app MUST keep working for core use (declaring providers, tracking quotas, getting recommendations) without any network dependency or mandatory backend service.

### Key Entities *(include if feature involves data)*

- **Provider**: An AI service or subscription the user declares. Has a stable identity, a name, an optional cost and currency, an optional colour, descriptive flags, a free note, a reset schedule, a display order, one or more quotas, and a fit level per task.
- **Quota**: A limit of a provider that the user tracks. Has a label, a type (consumed percentage, remaining percentage or currency balance with a symbol), a current value, and the set of tasks it gates.
- **Reset schedule**: How and when a provider's quota renews: weekly, monthly, custom cycle in days, or none. Carries the user-recorded next reset date when a cycle applies.
- **Task fit**: The user's declared suitability of a provider for one task of the fixed task list (strong, acceptable, weak, not suitable).
- **Recommendation**: The deterministic outcome for a task: a primary provider, alternatives, and a reason built from fit, quota state and reset timing.
- **Provider catalogue**: The full set of the user's providers, with their order, persisted locally and, when shared mode is on, across devices and backups.

## Constitution Alignment *(mandatory)*

- **User Value**: Routing quality now depends on the user's real subscriptions. A user who changes plan, drops a service or adds a new one keeps accurate advice without waiting for a code change, which directly improves the decision of which AI to use right now.
- **Determinism**: Recommendation rules become generic and operate only on declared attributes (task fit, normalised quota pressure, reset timing). They stay explicit, version-controlled and reproducible, with a documented tie-break. No heuristic or model-driven logic is introduced.
- **Verification Plan**: Because routing rules change, verification MUST include before/after scenarios. A reference set of scenarios recreates the former five fixed providers as user-declared providers and compares the recommendation of the previous rules with the generic rules, documenting any intended difference. Additional checks cover: empty catalogue, single provider, all blocked, ties, add/edit/delete effects on recommendations, validation refusals, persistence across reload, shared-mode sync and conflict, backup and restore, and references from other features after deletion.
- **Explainability**: Each recommendation states its reason from known inputs and lists alternatives. When a provider is excluded (not suitable, gated quota exhausted), the reason says so, so that the user can trace the outcome to what they declared.
- **Dependency & Privacy Impact**: No new runtime dependency is expected. Provider definitions are quota-related user data: they stay local by default and travel to the shared store only when the user turns shared mode on, as with existing quota state. **Constitution note**: the Product Constraints currently name Claude, ChatGPT, Copilot and pay-as-you-go APIs as the canonical scope and speak of quota modes "mapped per service". This feature generalises that scope to user-declared providers; a constitution amendment (wording of the canonical scope) is expected alongside this feature. The three explicit quota input modes remain unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user starting from an empty app can declare a first provider with one quota and see a recommendation based on it in under 2 minutes.
- **SC-002**: A user can recreate a typical setup of five providers with one or two quotas each in under 10 minutes.
- **SC-003**: 100% of provider additions, edits and deletions take effect on the dashboard and in the next recommendation without reinstalling, redeploying or editing any source file.
- **SC-004**: 100% of recommendations shown include a reason, and 100% of repeated computations on identical inputs return identical outcomes, regardless of provider creation or display order.
- **SC-005**: For the reference scenarios recreating the former five providers, the generic rules give the same primary provider as the previous rules in all scenarios except those explicitly documented as intended differences.
- **SC-006**: 100% of saved provider changes are visible after a reload, and 100% of cancelled or refused edits leave the provider unchanged.
- **SC-007**: With shared mode on, a change made on one device appears on another within the same delay as existing quota data, and 0 concurrent edits are silently overwritten.
- **SC-008**: A restored backup brings back 100% of the provider definitions and their quota data consistently.
- **SC-009**: With 20 providers declared, the dashboard remains usable and a recommendation appears immediately after a task is selected.

## Assumptions

- Users are individuals managing their own AI subscriptions on one or several of their own devices; there is no multi-user permission model for providers.
- "Provider" means any AI service, subscription or pay-as-you-go balance the user wants to track; there is no catalogue of known providers and no automatic discovery.
- The task list stays fixed (five tasks as of today) and is out of scope; only a provider's fit for those tasks is user-defined.
- Starting from an empty base is deliberate: no default provider, no template and no import of data from the previous fixed-provider version. The user declares everything.
- Task fit uses a small ordered scale chosen by the user per provider and per task; a missing value means not suitable. The exact scale labels and the way fit combines with quota pressure are defined at planning, documented and covered by tests.
- How a currency balance is turned into a comparable "pressure" is defined at planning, documented and tested; the user may declare a low-balance level per currency quota to support it.
- Provider "flags" and notes remain descriptive labels for the user; routing decisions rely on task fit and quota state, not on free-text flags.
- Feature 006 (surplus-runner) is implemented first and assumes services identified by name. This feature requires that anything provider-specific from 006 (for example the terminal tool used to run an idea, surplus settings, references from ideas and runs) be reattached to user-declared provider records. The exact reconciliation of 006 with dynamic providers is settled during planning of this feature and may require follow-up changes to 006.
- The existing shared-state backend, backup and export mechanisms are reused; no new infrastructure is introduced.
