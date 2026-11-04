# Feature Specification: dynamic-providers

**Feature Branch**: `007-dynamic-providers`  
**Created**: 2026-11-01  
**Last reviewed**: 2026-11-04 against the current codebase (features 001 to 006 merged; weekly history and surplus runner are now implemented)  
**Status**: Draft  
**Input**: User description: "being able to add, delete or modify providers so that the app is dynamic, not fixed or code static". Revision of 2026-11-04: "Update the spec considering the recent implementations of 006-surplus-runner and 005-weekly-history".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build My Own Provider List From Scratch (Priority: P1)

As a user, I want to declare the AI providers I actually use (name, what I pay, how their quota works, when it resets) from within the app, starting from an empty list, so that Kairos tracks my real subscriptions instead of a fixed set decided by the developer.

**Why this priority**: This is the core of the feature. Without it, any change of subscription requires a code change. It is also the new entry point of the app, since nothing is pre-filled.

**Independent Test**: Start with no stored data. Add three providers of different kinds (a weekly-reset subscription with two quotas, a monthly-reset subscription with one quota, a pay-as-you-go balance). Reload the app and confirm all three appear with their quotas, reset information and costs exactly as entered, and that no provider the user did not create is present.

**Acceptance Scenarios**:

1. **Given** the app is opened with no stored data, **When** the dashboard loads, **Then** no provider is shown, and an explanatory empty state invites the user to add a first provider.
2. **Given** the add-provider form is open, **When** the user enters a name, at least one quota (with a label, a quota type among consumed percentage, remaining percentage or currency balance, and a current value) and a reset schedule, **Then** the provider is created and appears on the dashboard immediately, with its quotas editable like any other, and each quota value counts as entered at that moment (its age is tracked from then on).
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

**Independent Test**: Take an existing provider, rename it, change its cost, add a quota, remove another quota, change the reset schedule, and verify that each change is reflected on the card, in recommendations and after reload. Then delete it and verify it disappears from the dashboard and from recommendations, while its past weeks remain readable in weekly history.

**Acceptance Scenarios**:

1. **Given** an existing provider, **When** the user edits its name, cost, colour, flags, note, reset schedule, task fits or quota definitions, **Then** the changes apply immediately and persist after a reload.
2. **Given** a provider with several quotas, **When** the user adds a quota or removes one (while at least one remains), **Then** the dashboard and recommendations use the updated set of quotas.
3. **Given** a quota with a current value, **When** the user changes its type (for example from consumed percentage to remaining percentage), **Then** the app asks the user to confirm or re-enter the value, and never silently reinterprets the old number.
4. **Given** the user chooses to delete a provider, **When** the confirmation is shown, **Then** it names the provider, states what will be removed (its quotas, reset dates and surplus settings) and what will be kept (its weekly history and the records of past runs, shown under its name as a removed provider), warns if a run is in progress on it, and offers cancel; only after explicit confirmation is the provider removed.
5. **Given** a provider is deleted, **When** the user views the dashboard and requests recommendations, **Then** the provider no longer appears as a live provider anywhere and is never proposed.
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
4. **Given** a backup exists, **When** the user restores it, **Then** the provider definitions, their quota data, their weekly history and their surplus records are restored together and consistently.
5. **Given** the user exports local data, **When** the export is produced, **Then** it includes the provider definitions.
6. **Given** weekly history reaches a device before the matching provider definitions, **When** the user opens the history, **Then** the weeks are shown from the information they carry, no provider is created by that, and the provider appears as a live one once its definition syncs.

---

### User Story 5 - Keep Weekly History And Surplus Suggestions Consistent With My Providers (Priority: P2)

As a user who already relies on weekly history and on surplus suggestions, I want both to follow the providers I declare, including when I rename, edit or delete them, so that my past weeks stay readable, the quota of my own providers that is about to expire still gets put to use, and nothing runs unattended on a provider I did not explicitly allow.

**Why this priority**: Weekly history and the surplus runner are delivered and today depend on a fixed list of five providers (two of them for surplus). Without this story, the dynamic list would either break them or leave them frozen on providers the user no longer has. It builds on creation and edit, hence P2.

**Independent Test**: Declare two providers, one of them with a supported terminal tool. Let a week be recorded, then rename one provider, add a quota to it and delete the other. Open weekly history: both series are readable under the right names, the deleted one is marked as removed, earlier weeks are unchanged. Enable surplus use on the provider with a terminal tool, put its reset two days away with fresh data and a waiting idea: a suggestion appears with the same rule outcomes the surplus runner gives for the same numbers today. Delete that provider: the suggestion disappears and its earlier run records still open.

**Acceptance Scenarios**:

1. **Given** providers with recorded quota values, **When** a new calendar week begins or a value changes, **Then** that week's snapshot holds one entry per provider, identified by the provider and carrying the name and quotas it had at that moment, and there is still at most one snapshot per week.
2. **Given** a provider that has history, **When** the user renames the provider or one of its quotas, **Then** past and future weeks form a single series under the new name, and snapshots already recorded are not rewritten.
3. **Given** a provider that has history, **When** the user deletes it, **Then** its weeks stay in the history (the current week included), labelled with the name captured at the time and marked as removed, and it is not offered as a live provider.
4. **Given** a provider created after earlier weeks were recorded, **When** the user opens its history, **Then** the earlier weeks show that no history was recorded for it, never zero consumption.
5. **Given** a provider, **When** the user declares a supported terminal tool for it, designates its main weekly quota and its short session window, and turns surplus use on, **Then** it is evaluated under the same rules as the surplus runner has today and appears in the surplus notice with its inputs and rule outcomes; a provider that does not meet these conditions never appears in surplus settings or suggestions, and the form says what is missing.
6. **Given** two eligible providers with the same reset day, **When** a suggestion is built, **Then** the same provider is proposed regardless of the order in which they were created or displayed, and the explanation names the tie-break used.
7. **Given** a provider just created or just received from the shared store, **When** the runner is running, **Then** no automatic run can start on it until the user has allowed that provider on the runner device and approved an idea there.
8. **Given** a run is in progress on a provider, **When** the user deletes the provider, turns its surplus use off or changes its terminal tool, **Then** the user is warned first, and after confirmation the run stops like a global stop: partial output kept, the idea retriable, the run record intact and still naming the provider.
9. **Given** ideas, run records and reset-cycle records that refer to a renamed or deleted provider, **When** the user opens them, **Then** they open without error and show the current name after a rename and the name captured with the record, marked as removed, after a deletion.

---

### User Story 6 - Set Up Providers Faster (Priority: P3)

As a user, I want to duplicate an existing provider and to reorder my providers, so that declaring similar providers or arranging the dashboard takes little effort.

**Why this priority**: A convenience on top of the core flows. Valuable once the user manages more than a few providers, but nothing depends on it.

**Independent Test**: Duplicate a provider, verify the copy carries its settings with a distinct name and independent data, then reorder providers and verify the order persists after reload.

**Acceptance Scenarios**:

1. **Given** an existing provider, **When** the user duplicates it, **Then** a new provider is created with the same settings and a distinct, editable name, and its quota values and reset dates are independent of the original. The copy starts with surplus use and automatic runs off, with no history and no allowance on the runner device.
2. **Given** several providers, **When** the user reorders them, **Then** the dashboard shows them in that order after a reload, without altering any recommendation or surplus outcome.

---

### Edge Cases

- Zero providers: the dashboard shows the empty state, recommendations explain that a provider must be added first, the surplus notice says that no provider is available for surplus use, and weekly history records nothing new.
- Exactly one provider: it is recommended when eligible, with no alternatives; when blocked, the app says nothing is available.
- Every provider is blocked for the selected task: the app says so, and shows when the soonest reset happens if reset dates are known.
- A provider has no declared fit for a given task: it is treated as not suitable for that task, and this default is visible to the user.
- Two providers share a name, differing only by case or surrounding spaces: treated as the same name and refused.
- A quota value is outside its allowed range, not a number, or a currency balance is negative: refused with an explanation.
- A reset schedule is changed (for example weekly to monthly) while a reset date is already recorded: the user is asked to confirm or update the next reset date, and an inconsistent date is flagged rather than trusted.
- A provider with surplus use on has its schedule changed to something other than weekly, or loses the designated weekly or session quota: it becomes not eligible for surplus with the reason shown, and its surplus settings are kept but inactive until the conditions hold again.
- A pay-as-you-go provider has no reset: it is never reported as "overdue".
- A provider is deleted while it is the one currently recommended: the recommendation is recomputed immediately.
- The last quota of a provider cannot be removed; the user must delete the provider instead.
- Two devices delete and edit the same provider at the same time: the user is informed, and the deleted provider is not silently resurrected.
- Data stored by the previous, fixed-provider version of the app is present on the device or in the shared store: its live quota values, reset dates, per-provider surplus settings and the runner's list of allowed services are not imported, not displayed as providers and not deleted. Its history records (weekly snapshots, run records, reset-cycle records, ideas that were launched) stay intact and readable, read-only, as records of removed providers. Ideas still waiting are not tied to a provider and are untouched.
- The user declares a provider with the same name as a former fixed one (for example "Claude"): it starts empty, with its own identity, and never inherits the former provider's quota values, history, surplus settings or runner allowance.
- A restored backup or an imported file contains invalid or unknown provider data: it is rejected or sanitised with a clear message, and the current list is left intact.
- A large number of providers (at least 20): the dashboard stays usable, recommendations stay immediate, and weekly history and surplus evaluation stay usable.
- A provider or a quota is renamed while other features (surplus ideas, runs, cycle records, weekly history) refer to it: the references follow the provider or quota, not the old name.
- A provider referenced by other features is deleted: those features keep their records, show the provider as removed under the name captured with the record, and never fail.
- A quota is removed or its type is changed after weeks were recorded: the earlier weekly entries stay as captured, with the type they were captured with, and are never rewritten.
- A provider is deleted in the middle of a week: the entry already recorded in that week's snapshot is kept, not dropped when the snapshot is next updated.
- A provider definition, tool choice or surplus setting is written by another device or client directly in the shared store (a mistaken or malicious write): it never authorises a run; the runner device's own allowance and the approval of the idea remain required.
- The terminal tool declared for a provider is missing or not signed in on the runner device: no run starts and the reason is shown, as today.
- Near local midnight: the days left before a reset shown on the dashboard, used by recommendations and used by the surplus evaluation agree.
- A recommendation and a surplus notice concern the same provider on the same screen: they never give opposite advice.

## Requirements *(mandatory)*

### Functional Requirements

**Provider management**

- **FR-001**: The app MUST start with no providers and MUST NOT ship, pre-fill or recreate any predefined provider.
- **FR-002**: Users MUST be able to add a provider with: a name (required, unique ignoring case and surrounding spaces), at least one quota (required), a reset schedule (required), and optionally a subscription cost with its currency, a colour, descriptive flags and a free note.
- **FR-003**: Users MUST be able to edit every attribute of a provider after creation, and the change MUST take effect immediately in the dashboard and in recommendations.
- **FR-004**: Users MUST be able to delete a provider after an explicit confirmation that states what will be removed and what will be kept (its weekly history and the records of its past runs). A provider MUST never be deleted without that confirmation.
- **FR-005**: Each provider MUST own one or more quotas. Each quota MUST have a label, a type among the three explicit input modes (consumed percentage, remaining percentage, currency balance with a currency symbol) and a current value. Users MUST be able to add, edit and remove quotas of an existing provider, but never remove the last one.
- **FR-006**: Quota values MUST be validated against their type (percentages within 0–100, currency balances not negative), and invalid input MUST be refused with an explanation next to the field.
- **FR-007**: Changing a quota's type MUST require the user to confirm or re-enter its value; the system MUST NOT silently reinterpret the stored number.
- **FR-008**: Users MUST be able to declare a reset schedule per provider among: weekly, monthly, a custom cycle in days, or none (pay-as-you-go). The existing per-provider reset date tracking MUST keep working for every schedule that has a cycle.
- **FR-009**: The system MUST support at least 20 providers without degradation of dashboard use, recommendation speed, weekly history review or surplus evaluation.
- **FR-010**: Users MUST be able to duplicate a provider and to reorder providers; the order MUST persist and MUST NOT influence any recommendation or surplus outcome. A duplicate MUST start with surplus use and automatic runs off and with no history.
- **FR-039**: A quota value entered when a provider is created or edited MUST be recorded as entered at that moment, and the existing one-action confirmation that quota values are still current MUST work for every provider, so that the age of each reading is always known.

**Recommendations**

- **FR-011**: Recommendations MUST be computed solely from user-declared provider data and the selected task. The rules MUST NOT reference any specific provider by name or identifier.
- **FR-012**: For each provider, users MUST be able to declare how well it fits each task of the fixed task list (at least: strong fit, acceptable fit, weak fit, not suitable), and, for each quota, which tasks it gates (default: all tasks). A task with no declared fit MUST be treated as not suitable.
- **FR-013**: Recommendation rules MUST derive a provider's eligibility and rank for a task from: its fit for the task, the state of the quotas that gate that task (normalised across the three quota types so that they are comparable), and its reset timing.
- **FR-014**: The rules MUST be deterministic and version-controlled: identical inputs MUST always produce the same primary provider, alternatives and reason, and the order in which providers were created or displayed MUST NOT change the outcome (ties are broken by an explicit, documented criterion that does not depend on that order).
- **FR-015**: The existing reset-aware behaviour MUST be preserved in generic form: when two eligible providers have comparable quota pressure, the one resetting sooner MUST be preferred, and a due or overdue reset MUST be noted in the reason.
- **FR-016**: Every recommendation MUST include a concise reason stating the inputs that drove it (fit, quota state, reset timing), the primary provider and the alternatives. When no provider is eligible, the app MUST state that and why.
- **FR-017**: Adding, editing or deleting a provider MUST update the recommendation the next time it is shown, and an already displayed recommendation MUST NOT keep referring to a deleted provider.
- **FR-018**: The task list MUST remain unchanged by this feature; tasks are not user-editable.

**Persistence, sharing and safety**

- **FR-019**: Provider definitions MUST be stored with the same scope, consistency and conflict handling as the existing quota state: local-first, with shared persistence across devices when shared mode is on, and readable by the optional runner in shared mode (FR-035).
- **FR-020**: Provider definitions MUST be part of backups, restores and local exports, and a restore MUST bring definitions, quota data, weekly history and surplus records back consistently.
- **FR-021**: Every edit MUST be atomic from the user's point of view: a refused or cancelled edit MUST leave the provider exactly as it was, and an interrupted save MUST never leave a half-defined provider.
- **FR-022**: Data held by the previous fixed-provider version MUST NOT be imported, shown as a provider or modified: this covers its live quota values and reset dates, its per-provider surplus settings and the runner's list of allowed services. The user starts from an empty base. Records of its history (weekly snapshots, run records, reset-cycle records, launched ideas) MUST NOT be deleted: they stay readable, read-only, as records of removed providers. A new provider MUST NOT inherit any of this data, even if it has the same name as a former fixed provider.
- **FR-023**: Every provider and every quota MUST have a stable identity, created by the app, that survives renames and is never derived from the name or equal to an identity used by the previous fixed-provider version. Other features (weekly history, surplus ideas, runs, reset-cycle records, per-provider surplus settings, the runner's allowance) MUST identify providers and quotas by that identity.
- **FR-024**: Anything provider-specific that other features need (the terminal tool used to run an idea, which quota is the main weekly quota and which the short session window, surplus settings, the runner's allowance) MUST be tied to the provider's identity and MUST NOT rely on a hard-coded provider name or identifier.
- **FR-025**: The app MUST keep working for core use (declaring providers, tracking quotas, getting recommendations, weekly history, surplus suggestions) without any network dependency or mandatory backend service. Only automatic runs require shared mode and the runner, as today.

**Weekly history (feature 005)**

- **FR-026**: Weekly history MUST be recorded for the user's providers: each calendar week has at most one snapshot per workspace, holding one entry per provider that existed that week, with the provider's identity, the name it had, and its quotas (identity, label, type, value). While no provider exists, nothing new is recorded.
- **FR-027**: History MUST follow identities, not names: renaming a provider or a quota continues the same series, and a snapshot already recorded MUST NOT be rewritten by a rename or any later edit.
- **FR-028**: When a provider is deleted, its entry MUST remain in every snapshot that already contains it, the current week's included, and the provider MUST stay reviewable in weekly history under the name captured, marked as removed, for as long as snapshots are retained (at least 52 completed weeks).
- **FR-029**: A week before a provider existed MUST be shown as having no recorded history for it, never as zero consumption. A quota that was removed or whose type was edited MUST keep its earlier entries as captured, showing the type each entry was captured with.
- **FR-030**: Snapshots received from another device that mention a provider unknown on this device MUST be shown from the information they carry, without creating, altering or reviving a provider. Recording or displaying history MUST NOT change any live provider or quota value.

**Surplus runner (feature 006)**

- **FR-031**: Surplus use MUST be a per-provider choice, offered only to a provider that (a) declares one of the terminal tools supported by the runner (today the tools for Claude and for ChatGPT Codex), (b) has a weekly reset schedule, and (c) designates which of its percentage quotas is the main weekly quota and which is the short session window. A provider that does not meet these conditions MUST NOT appear in surplus settings, notices or suggestions, and its form MUST say what is missing.
- **FR-032**: For a provider so configured, every rule of feature 006 (eligibility, selection, reserve, evaluation window, data freshness, session room, protected hours, explained evaluation, manual instruction, runs, results, reset-cycle records) MUST keep the same meaning and defaults, using the provider's declared quotas, reset date and terminal tool in place of the former fixed service definitions. The global surplus settings (protected hours, cost calibration, thresholds, projects base folder) MUST stay global.
- **FR-033**: Per-provider surplus settings (use on or off, reserve, evaluation window, automatic runs on or off, acknowledgement of the disclosures) MUST follow the provider's identity, MUST start off for every new provider (the disclosures having to be acknowledged again), and MUST stop having any effect when the provider is deleted.
- **FR-034**: When several providers are eligible, the one resetting soonest MUST be proposed first, and ties MUST be broken by the same documented, order-independent criterion as FR-014. This replaces the tie-break by display order that feature 006 uses today.
- **FR-035**: The runner MUST learn the user's providers from the shared store and MUST treat everything arriving from it as untrusted for authorisation. A provider, a terminal-tool choice or a surplus setting received from the store MUST NOT by itself allow any run: automatic runs on a provider remain possible only after the user has allowed that provider on the runner device and approved the idea there (feature 006 FR-012 to FR-014). A provider the runner has not been told to allow MUST never be run.
- **FR-036**: Run records, reset-cycle records and ideas that refer to a provider MUST stay readable after it is renamed or deleted, showing the current name after a rename and the name captured with the record, marked as removed, after a deletion. They MUST never fail to open. A run record MUST keep the provider name as it was when the run started.
- **FR-037**: Deleting a provider, turning its surplus use or automatic runs off, or changing its terminal tool while a run is active on it MUST first warn the user, then stop the run as a global stop does: partial output kept, idea retriable, record intact.
- **FR-038**: A surplus notice and a recommendation concerning the same provider MUST NOT give opposite advice on the same screen, and the number of days before a reset MUST be counted the same way (in the user's local calendar days) in the dashboard, in recommendations and in the surplus evaluation.

### Key Entities *(include if feature involves data)*

- **Provider**: An AI service or subscription the user declares. Has a stable identity, a name, an optional cost and currency, an optional colour, descriptive flags, a free note, a reset schedule, a display order, one or more quotas, a fit level per task, and optionally a surplus profile.
- **Quota**: A limit of a provider that the user tracks. Has a stable identity, a label, a type (consumed percentage, remaining percentage or currency balance with a symbol), a current value, the time it was last entered or confirmed, and the set of tasks it gates.
- **Reset schedule**: How and when a provider's quota renews: weekly, monthly, custom cycle in days, or none. Carries the user-recorded next reset date when a cycle applies.
- **Task fit**: The user's declared suitability of a provider for one task of the fixed task list (strong, acceptable, weak, not suitable).
- **Surplus profile**: What lets a provider take part in surplus suggestions and runs: its terminal tool, its designated main weekly quota and short session window, and its per-provider settings (use, reserve, evaluation window, automatic runs, acknowledgement of the disclosures). The runner device keeps its own allowance for the provider, separate from this profile.
- **Recommendation**: The deterministic outcome for a task: a primary provider, alternatives, and a reason built from fit, quota state and reset timing.
- **Provider catalogue**: The full set of the user's providers, with their order, persisted locally and, when shared mode is on, across devices and backups, and readable by the runner.
- **Removed provider reference**: What weekly history, ideas, run records and reset-cycle records keep of a deleted provider: its identity and the name captured at the time, enough to show the provider as removed without failing.
- **Weekly snapshot (feature 005)**: One record per workspace and calendar week, holding for each provider present that week its identity, name and quotas as captured. Never rewritten by later edits and never dropped from a week when the provider is deleted.

## Constitution Alignment *(mandatory)*

- **User Value**: Routing quality now depends on the user's real subscriptions. A user who changes plan, drops a service or adds a new one keeps accurate advice without waiting for a code change, which directly improves the decision of which AI to use right now. The same holds for weekly history and surplus suggestions, which stop being limited to a fixed list and keep serving the providers the user actually has, so that expiring quota is still spent on the right provider and past weeks stay understandable.
- **Determinism**: Recommendation rules become generic and operate only on declared attributes (task fit, normalised quota pressure, reset timing). They stay explicit, version-controlled and reproducible, with a documented tie-break that does not depend on creation or display order, and the surplus selection uses the same criterion. No heuristic or model-driven logic is introduced, and no model decides whether a run happens.
- **Verification Plan**: Because routing rules change, verification MUST include before/after scenarios. A reference set of scenarios recreates the former five fixed providers as user-declared providers and compares the recommendation of the previous rules with the generic rules, documenting any intended difference. The surplus scenario of feature 006 is replayed on user-declared providers (60% of the weekly quota remaining, reset in 2 days, data confirmed 2 hours ago, session window 60% remaining, one approved medium idea: the idea is suggested with its rationale; the same state with data confirmed 20 hours ago, or with the reset due today, gives no suggestion and a stated reason) and must give the same outcome as today, except for the documented tie-break change. Additional checks cover: empty catalogue, single provider, all blocked, ties and their independence from creation and display order, add/edit/delete effects on recommendations, validation refusals, persistence across reload, shared-mode sync and conflict, backup and restore, weekly history across rename, quota edit, deletion (current week included) and late creation, former fixed-provider data left untouched and never inherited by a same-name provider, surplus conditions per provider, a provider written directly into the shared store never authorising a run, a run stopped by the deletion of its provider, and records of other features opening after deletion.
- **Explainability**: Each recommendation states its reason from known inputs and lists alternatives. When a provider is excluded (not suitable, gated quota exhausted), the reason says so, so that the user can trace the outcome to what they declared. Surplus evaluations keep showing their inputs and the pass or fail of each rule, and name the tie-break when one applies.
- **Dependency & Privacy Impact**: No new runtime dependency is expected, and no change to the shared-state backend is expected, since provider definitions are stored as ordinary shared records. Provider definitions are quota-related user data: they stay local by default and travel to the shared store only when the user turns shared mode on, as with existing quota state. In shared mode the optional runner, which runs on the user's own machine, also reads them; nothing about a provider other than what feature 006 already discloses (idea text, context and the disposable copy of the working folder) is ever sent to an AI provider, so names, flags, notes and costs stay within the user's workspace. Because shared-store access is not yet authenticated, the runner treats the catalogue as untrusted for authorisation (FR-035). **Constitution note**: the Product Constraints currently name Claude, ChatGPT, Copilot and pay-as-you-go APIs as the canonical scope and speak of quota modes "mapped per service". This feature generalises that scope to user-declared providers; a constitution amendment (wording of the canonical scope) is expected alongside this feature. The three explicit quota input modes remain unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user starting from an empty app can declare a first provider with one quota and see a recommendation based on it in under 2 minutes.
- **SC-002**: A user can recreate a typical setup of five providers with one or two quotas each in under 10 minutes.
- **SC-003**: 100% of provider additions, edits and deletions take effect on the dashboard and in the next recommendation without reinstalling, redeploying or editing any source file.
- **SC-004**: 100% of recommendations shown include a reason, and 100% of repeated computations on identical inputs return identical outcomes, regardless of provider creation or display order.
- **SC-005**: For the reference scenarios recreating the former five providers, the generic rules give the same primary provider as the previous rules in all scenarios except those explicitly documented as intended differences. For the surplus scenarios of feature 006 replayed on user-declared providers, eligibility, selection and displayed rule outcomes are identical, except the documented tie-break change.
- **SC-006**: 100% of saved provider changes are visible after a reload, and 100% of cancelled or refused edits leave the provider unchanged.
- **SC-007**: With shared mode on, a change made on one device appears on another within the same delay as existing quota data, and 0 concurrent edits are silently overwritten.
- **SC-008**: A restored backup brings back 100% of the provider definitions, their quota data, their weekly history and their surplus records consistently.
- **SC-009**: With 20 providers declared, the dashboard remains usable and a recommendation appears immediately after a task is selected.
- **SC-010**: After a provider is renamed, edited or deleted, 100% of the weeks previously recorded for it remain readable in weekly history with unchanged values, and a deleted provider is shown as removed under the name captured.
- **SC-011**: In 100% of guardrail checks, no automatic run starts on a provider that is not allowed on the runner device, including a provider created or modified directly in the shared store; and 100% of runs stopped by the deletion of their provider end with a record that still names it.
- **SC-012**: 100% of ideas, run records and reset-cycle records that refer to a renamed or deleted provider open without error and show the right name.
- **SC-013**: A user starting from an empty app can enable surplus use on a provider that has a supported terminal tool and see why it is or is not eligible in under 3 minutes after declaring it.

## Assumptions

- Users are individuals managing their own AI subscriptions on one or several of their own devices; there is no multi-user permission model for providers.
- "Provider" means any AI service, subscription or pay-as-you-go balance the user wants to track; there is no catalogue of known providers and no automatic discovery.
- The task list stays fixed (five tasks as of today) and is out of scope; only a provider's fit for those tasks is user-defined.
- Starting from an empty base is deliberate: no default provider, no template and no import of live data from the previous fixed-provider version. The user declares everything. Linking a new provider to the history of a former fixed one is out of scope: history of former providers stays readable but separate.
- History is kept, not purged, when a provider is deleted, in line with weekly history (feature 005, which requires snapshots of removed services to be preserved) and with feature 006 (records keep working with the provider shown as removed). Snapshots age out under the existing 52-week retention. A way to purge the history of a deleted provider is out of scope.
- Task fit uses a small ordered scale chosen by the user per provider and per task; a missing value means not suitable. The exact scale labels and the way fit combines with quota pressure are defined at planning, documented and covered by tests.
- How a currency balance is turned into a comparable "pressure" is defined at planning, documented and tested; the user may declare a low-balance level per currency quota to support it.
- Provider "flags" and notes remain descriptive labels for the user; routing decisions rely on task fit and quota state, not on free-text flags.
- The order-independent tie-break criterion used by recommendations and by surplus selection (FR-014, FR-034) is chosen at planning, documented, and covered by tests. It replaces the display-order tie-break of feature 006 and may be an intended difference in the before/after scenarios.
- Features 005 (weekly history) and 006 (surplus runner) are implemented and merged. They currently depend on a fixed catalogue of five services: weekly snapshots are built from it, surplus is limited to two named services whose main weekly quota, short session window and terminal tool are written into the catalogue, per-service surplus settings and the runner's allowed-services list are keyed by those fixed names, the manual instruction and the runner read the catalogue directly, and run records, reset-cycle records and history are validated against that fixed list. Reconciling them with user-declared providers is part of this feature (FR-026 to FR-038), not a follow-up; the exact changes to their stored data and to the runner are settled at planning.
- Surplus support stays limited, as in feature 006, to providers that have a supported terminal tool and a weekly reset: the calibrations (reserve, evaluation window, cost per idea size) are weekly ones. Surplus for monthly, custom-cycle or pay-as-you-go providers, additional terminal tools, and an optional session window are out of scope. The session-window rule stays mandatory exactly as in feature 006, so a provider needs both a main weekly quota and a short session window to be surplus-eligible.
- The runner device keeps its own allowance of providers and its own approvals, as in feature 006. Allowing a provider on the runner device is an explicit action there, and providers coming from the shared store start disallowed. Making shared-store access authenticated is a separate feature; if it is delivered first, the plan may relax how the allowance is confirmed.
- The existing shared-state backend, backup and export mechanisms are reused; no new infrastructure is introduced. The existing local export carries quota state and weekly history, not surplus records; this feature adds the provider definitions to it and does not widen it further.
