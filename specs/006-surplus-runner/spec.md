# Feature Specification: surplus-runner

**Feature Branch**: `006-surplus-runner`  
**Created**: 2026-10-31  
**Status**: Draft  
**Input**: User description: "Surplus runner — let the user capture ideas and non-urgent tasks on the fly. Given the user's declared LLM subscriptions and their weekly reset dates, when quota remains close to a reset and ideas are waiting, the app sends an idea to the LLM through the terminal so that unused weekly budget is not wasted and the idea moves forward."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture Non-Urgent Ideas On The Fly (Priority: P1)

As a user, I want to jot down an idea or a non-urgent task in a few seconds, optionally with context information and the folder to work in, so that it waits in a queue until there is spare quota to work on it.

**Why this priority**: Without a queue there is nothing to spend surplus on. The queue is also useful on its own as a parking lot for ideas.

**Independent Test**: Capture several ideas with different priorities and sizes, some with context information and a working folder, edit them, reorder them and archive one. Reload the app and confirm the queue is unchanged. With shared mode enabled, confirm another device sees the same queue.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** the user types an idea and confirms, **Then** the idea appears in the queue as "waiting" within three interactions, with a default priority and size.
2. **Given** waiting ideas exist, **When** the user changes an idea's priority, size, context information, working folder or automatic-run approval, **Then** the queue reflects the change immediately and after a reload.
3. **Given** an idea, **When** the user archives or deletes it, **Then** it is no longer considered for any evaluation, and archived ideas remain viewable.
4. **Given** the user is capturing or editing an idea, **When** they add context information and/or a working folder path, **Then** both are saved with the idea and shown in its details.
5. **Given** an idea with context information or a working folder, **When** the user changes its text, context or working folder, **Then** its automatic-run approval is withdrawn and the user is told it must be approved again.
6. **Given** an idea captured on one device, **When** the user opens it on another, **Then** the working folder appears exactly as typed, and it is checked only on the runner device.

---

### User Story 2 - See Expiring Surplus And Get An Explained Suggestion (Priority: P1)

As a user, I want Kairos to tell me when a service has quota that will expire unused soon, and which waiting idea fits it and why, so that I can launch the idea myself.

**Why this priority**: This is the MVP. It delivers the waste-reduction value with no automation and no execution risk, and it is the foundation for automatic runs.

**Independent Test**: Set tracked quota and reset dates to known values and verify that each service is reported eligible or not eligible exactly as the rules dictate, with reasons. Confirm nothing is executed.

**Acceptance Scenarios**:

1. **Given** a service enabled for surplus use, a reset within the evaluation window, tracked remaining quota above the reserve plus the idea's estimated cost, and fresh quota data, **When** the user opens the dashboard, **Then** a surplus notice shows the service, the quota expected to expire, the suggested idea and the rationale.
2. **Given** the same service but quota data older than the freshness limit, **When** the evaluation runs, **Then** the service is not eligible, the reason is shown and the user is prompted to refresh the quota.
3. **Given** a suggested idea, **When** the user chooses to launch it manually, **Then** the app provides a ready-to-use, copyable instruction for that service, and marks the idea "launched manually" once the user confirms.
4. **Given** two eligible services, **When** a suggestion is built, **Then** the service resetting sooner is proposed first and the other is listed as an alternative.
5. **Given** no waiting idea or no eligible service, **When** the user opens the dashboard, **Then** the app says so and states why, rather than showing an empty or ambiguous state.

---

### User Story 3 - Let Kairos Run Approved Ideas Automatically Within Guardrails (Priority: P2)

As a user, I want to authorize Kairos to start approved ideas on a service by itself when surplus conditions hold, so that expiring quota is used even when I am away.

**Why this priority**: It completes the value of the feature but adds execution risk, so it builds on the queue and the explained evaluation.

**Independent Test**: Enable automatic runs for one service, approve one idea and place the reset inside the window: exactly one run starts and its outcome is recorded. Then break each guardrail in turn (stale data, protected hours, quota at reserve, idea not approved, global stop) and confirm that no run starts.

**Acceptance Scenarios**:

1. **Given** automatic runs are enabled for a service, an approved idea exists and every eligibility condition holds, **When** an evaluation happens, **Then** exactly one run starts for that idea and the idea becomes "running".
2. **Given** any eligibility condition fails, or the idea is not approved, **When** an evaluation happens, **Then** no run starts and the reason is recorded.
3. **Given** a run is in progress, **When** the user triggers the global stop, **Then** the run is stopped, the idea returns to a retriable state and no new run starts until automatic runs are re-enabled.
4. **Given** protected hours are declared, **When** an evaluation happens, **Then** no run starts if its maximum duration would reach the protected hours, and any running run is stopped before the protected hours begin.
5. **Given** a run is in progress, **When** the remaining quota reaches the reserve or the quota resets, **Then** the run stops and its partial output is kept.
6. **Given** the user enables automatic runs for a service for the first time, **When** they confirm, **Then** they have first been shown the disclosures (what leaves the device, provider-rule caveat) and have acknowledged them.

---

### User Story 4 - Review Results And Measure Recovered Surplus (Priority: P3)

As a user, I want to review what each run produced and how much otherwise-expiring quota was used, so that I can trust the feature and tune its settings.

**Why this priority**: Results review makes automatic runs trustworthy, and measurement lets the user verify that the feature actually reduces waste.

**Independent Test**: Produce a completed, a failed and an interrupted run. Verify each has a record, that results can be accepted, discarded or re-queued, and that the weekly summary reflects them.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** the user opens its result, **Then** they see the idea, the service, start and end times, the outcome status, the produced output as a draft, and the decision inputs that triggered the run.
2. **Given** a result, **When** the user accepts, discards or re-queues it, **Then** the idea status updates, and accepting changes nothing outside Kairos.
3. **Given** several weeks of history, **When** the user reviews them, **Then** they see, per week, the quota left at reset and the part of it consumed by runs.
4. **Given** a failed run, **When** the user opens its record, **Then** the failure reason is shown (for example tool unavailable, not signed in, quota exhausted, stopped by user, timed out).

### Edge Cases

- Quota data was never entered or is older than the freshness limit.
- The reset date is missing, overdue, or was moved by the provider (for example an early provider-initiated reset): the service is treated as not eligible, never assumed.
- The quota resets before a run would start: there is nothing left to save, so no run starts.
- The user works on the same service during a run and consumes the surplus: the run stops at the reserve.
- The short session window is exhausted while the weekly quota still has room: the service is not eligible until the session window frees up.
- Two devices open the same workspace: only the designated runner dispatches, and an idea is never started twice, including after a restart.
- The runner device is asleep or offline when a window opens: the window is skipped, with no catch-up after the reset.
- The service's official terminal tool is missing, not signed in, or configured to bill outside the subscription: no run starts and the reason is shown.
- The provider changes its rules so that automated usage is no longer covered by the subscription limits: the user can switch every service back to suggestion-only at any time.
- A run needs information only the user can give: it ends as "needs input" and the idea is flagged.
- An idea or its context contains sensitive information: the user is told that the idea text, its context and the contents of the working folder's disposable copy are sent to the chosen provider when a run starts.
- An idea has no working folder: it is limited to work that needs no project files (research, drafting, review of text contained in the idea or its context).
- The working folder does not exist, was moved or renamed, or exists only on another device: the idea is not eligible for an automatic run and the reason is shown.
- A relative path is given but no projects base folder is declared: the folder is treated as missing.
- The working folder is a system location, the user's whole home folder, or larger than the copy limit: it is refused with an explanation.
- The working folder contains credential or secret files: they are excluded from the disposable copy by default.
- Two ideas share the same working folder: they never run at the same time, and each gets its own disposable copy.
- The context information is empty, or exceeds the size limit: the user is told when capturing it.
- A service is renamed, hidden or removed while ideas or runs refer to it.
- A run produces empty or very large output.

## Requirements *(mandatory)*

### Functional Requirements

**Idea queue**

- **FR-001**: Users MUST be able to capture an idea with a text (required), optional context information, an optional working folder, a priority (default normal), a size class small/medium/large (default medium) and an automatic-run approval (default not approved). Context information and the working folder are specified in FR-026 to FR-030.
- **FR-002**: Users MUST be able to edit, reorder, archive and delete ideas. An idea MUST have one status at a time among: waiting, launched manually, running, completed, failed, needs input, archived.
- **FR-003**: The system MUST persist the queue with the same scope and consistency guarantees as the existing quota state, local-first, and shared across devices when shared mode is on.

**Idea context and working folder**

- **FR-026**: An idea MUST be able to carry free-form context information in addition to its text (for example goals, constraints, links or expected outcome), up to a documented size limit (default 10,000 characters). The context MUST be visible in the idea's details and MUST be included whenever a run starts or a manual instruction is built.
- **FR-027**: An idea MAY carry a working folder, given as an absolute path or as a path relative to a projects base folder that the user declares once. The path MUST be interpreted on the runner device, not on the device where the idea was captured.
- **FR-028**: Before an automatic run starts, the system MUST verify on the runner device that the working folder exists and is readable. If it does not, no run starts for that idea and the reason (for example folder not found, not readable, or relative path without a base folder) MUST be shown.
- **FR-029**: Any change to an idea's text, context information or working folder MUST withdraw its automatic-run approval until the user approves it again, and the approval step MUST show the exact working folder being approved.
- **FR-030**: The system MUST refuse a working folder that is a system location, the user's whole home folder, or larger than the documented copy limit (default 1 GB), and MUST say why. The disposable copy MUST exclude files likely to hold credentials by default, and the user MUST be able to review and adjust the exclusions.

**Surplus policy**

- **FR-004**: For each supported service, users MUST be able to set: surplus use on or off (default off), the reserve to keep as a percentage of the weekly quota (default 20%), the evaluation window before the reset (default 48 hours), and automatic runs on or off (default off).
- **FR-005**: Users MUST be able to declare protected hours during which no run may be active. A run MUST NOT start if its maximum duration would reach the protected hours. Protected hours MUST be declared before automatic runs can be enabled.
- **FR-006**: Users MUST be able to calibrate the estimated quota cost of each size class, starting from documented defaults.

**Surplus evaluation**

- **FR-007**: A service MUST be considered surplus-eligible only if all of the following hold: surplus use is on; the reset date is known, not overdue and inside the evaluation window; quota data was refreshed within the freshness limit (default 12 hours); the remaining weekly quota is at least the reserve plus the candidate idea's estimated cost; the short session window has room; and a run started now would end, at its maximum duration, before the protected hours begin.
- **FR-008**: Candidate selection MUST be deterministic: highest priority first, then the largest size class that fits the available surplus, then oldest first. When several services are eligible, the one resetting soonest MUST be proposed first. Ideas whose working folder fails the check of FR-028 MUST be skipped for automatic runs, and the reason MUST be shown.
- **FR-009**: Every evaluation MUST display its inputs, the pass or fail of each rule and either the selected idea and service or the reasons for no selection. The same inputs MUST always produce the same outcome.
- **FR-010**: Users MUST be able to preview what would be launched right now, without launching anything.

**Suggestion**

- **FR-011**: For a suggested idea, the system MUST provide a ready-to-use, copyable instruction for starting it on the chosen service, including the idea's context information and its working folder, and let the user confirm that they launched it.

**Automatic runs**

- **FR-012**: Automatic runs MUST be opt-in per service and off by default. The first activation MUST require the user to acknowledge the disclosures (what leaves the device, and that provider rules for automated usage can change). A global stop control MUST always be visible and effective before the next run starts.
- **FR-013**: Only ideas explicitly approved by the user MAY be run automatically.
- **FR-014**: At most one run MUST be active per workspace, and exactly one designated runner device per workspace MUST be allowed to start runs.
- **FR-015**: Runs MUST use only the service's official terminal tool as already signed in by the user. The system MUST NOT read, copy, store or transmit credentials or session tokens, and MUST NOT start a run that would be billed outside the user's subscription quota.
- **FR-016**: Every run MUST be bounded by a maximum duration and MUST stop when the remaining quota reaches the reserve, when the quota resets, or when protected hours begin.
- **FR-017**: An unattended run MUST work only inside a disposable copy of the idea's working folder and MUST NOT read or modify the original folder, other user files or system settings. Any changes it produces MUST be stored as a proposal for the user's review, and an idea without a working folder MUST be limited to drafts that need no project files. The disposable copy MUST be removable by the user at any time.
- **FR-018**: An idea MUST never be started twice concurrently, and a failed idea MUST NOT be retried automatically more than once per reset window.
- **FR-019**: Run output and proposed changes MUST be stored as drafts and MUST NOT be applied automatically to any user data; applying them is always a separate user action.

**Results**

- **FR-020**: Each run MUST produce an immutable record containing the idea (with its context information and working folder), the service, start and end times, the final status, a snapshot of the decision inputs, the estimated quota consumed and the output.
- **FR-021**: A failed or interrupted run MUST record a human-readable reason and leave the idea in a retriable state.
- **FR-022**: When weekly history is available, the system MUST show per week the quota left at reset and the part consumed by runs.

**Cross-cutting**

- **FR-023**: The dashboard, the idea queue, the evaluation and the suggestions MUST remain fully usable without the automatic-run capability and without network access.
- **FR-024**: Idea text, context information and the contents of the disposable copy MUST leave the device only when a run starts (or, for the text and context, when the user launches the idea manually) and only toward the chosen service. Quota data, other ideas and files outside the disposable copy MUST never be sent.
- **FR-025**: Users MUST be able to switch every service back to suggestion-only at any time, and the app MUST display a standing notice that provider rules on automated usage can change.

### Key Entities *(include if feature involves data)*

- **Idea**: A non-urgent task or idea with text, optional context information, priority, size class, optional working folder, approval flag and status.
- **Working Folder**: The folder, identified by a path interpreted on the runner device, in which an idea is to be worked on. An unattended run works on a disposable copy of it.
- **Surplus Policy**: Per-service settings: surplus on or off, reserve, evaluation window, automatic runs on or off; plus the user's protected hours and cost calibration.
- **Surplus Evaluation**: A reproducible decision for a given moment: the inputs, the result of each rule, and the selected idea and service or the reasons for none.
- **Run**: One execution of an idea on a service, with timing, status and bounds.
- **Run Result**: The draft output and the failure reason of a run, reviewable by the user.
- **Protected Hours**: The periods in which the user needs their own quota and no run may be active or start.
- **Runner**: The single designated device allowed to start runs for a workspace.

## Constitution Alignment *(mandatory)*

- **User Value**: Extends routing from "which service for this task now" to its mirror, "which task for this expiring quota", using the same inputs (quota state and reset dates). It improves quota visibility by showing what will expire unused, and removes the decision latency of remembering to spend it. This is the written justification required by Principle I for work beyond pure tool selection.
- **Determinism**: Eligibility and selection come from explicit, versioned rules with named thresholds (FR-007, FR-008). No model decides whether or when a run happens; the model only executes the idea once the rules have already selected it.
- **Verification Plan**: Scenario-based checks for each rule in FR-007 (one passing and one failing case per condition), selection ordering, idempotence of runs, guardrail enforcement and kill-switch. Before/after scenario for the recommendation logic: quota 60% remaining, reset in 30 hours, fresh data, one approved medium idea, nothing suggested before the feature versus the idea suggested with its rationale after it; the same state with data 20 hours old yields no suggestion with a stated reason.
- **Explainability**: Every suggestion and every run shows its inputs and rule outcomes (FR-009), and each run record stores the inputs snapshot (FR-020), so a decision can be reproduced during review.
- **Dependency & Privacy Impact**: The spec requires no new runtime dependency in the browser dashboard. Automatic runs necessarily execute outside a static browser page, which tensions the Product Constraint that the app function as a static frontend without mandatory backend services. This is addressed by keeping the capability optional (FR-023) and MUST be tracked as an exception in the plan's Complexity Tracking. Quota data stays local (FR-024). Idea text, context information and a copy of the working folder reach the provider only on an explicit per-service opt-in plus a per-idea approval tied to that specific folder, which satisfies Principle V's requirement of explicit user action and disclosure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can capture a new idea (text only) in under 10 seconds and no more than three interactions from the dashboard.
- **SC-002**: In 100% of evaluation checks, the eligibility outcome can be reproduced from the displayed inputs and rule results alone.
- **SC-003**: For users with at least three waiting ideas, the share of weekly quota left unused at reset on enabled services decreases by at least 50% compared with their previous four recorded weeks.
- **SC-004**: In 100% of guardrail checks, no run starts with stale quota data, quota at or below the reserve, outside the evaluation window, for an unapproved idea, for an idea whose working folder is missing or refused, during protected hours, or after the global stop.
- **SC-005**: In at least 95% of weeks with automatic runs enabled, the user's service still has its reserve available at the start of their next planned work session.
- **SC-006**: 100% of runs end with a record that shows either a reviewable output or an explicit failure reason.
- **SC-007**: The global stop prevents the next run in 100% of checks, and a user can trigger it in under 5 seconds.

## Assumptions

- Quota remains tracked through the existing user-entered quota state and reset dates (features 003 and 004). Reading quota automatically from providers is out of scope, because the available signals are not official interfaces and could change.
- Version 1 supports the services that have an official terminal tool and a weekly reset: Claude and ChatGPT Codex. GitHub Copilot, OpenRouter and Kilocode are out of scope.
- Defaults (48-hour window, 20% reserve, 12-hour freshness, 60-minute maximum run duration, 10,000-character context limit, 1 GB limit for the disposable copy, size-class cost estimates of about 3%, 8% and 15% of the weekly quota) are starting points that the user can change, and they are not provider guarantees.
- Estimates of consumption are approximate. The reserve and freshness rules exist to absorb that uncertainty.
- Provider terms and billing rules for automated usage of subscriptions can change, and a change to non-interactive usage was announced and then paused in 2026. The feature must therefore always be able to fall back to suggestion-only (FR-025).
- Measuring recovered surplus (User Story 4, SC-003) relies on weekly history (feature 005), which is pending merge. Until it is available, the weekly summary of FR-022 is omitted.
- The dashboard remains the single place where ideas are captured in version 1. Importing from external note or task tools is out of scope.
- A run's output is a draft for the user's review, not an action taken on their behalf.
- A working folder path only has meaning on the device that runs ideas. When an idea is captured on another device, the path is stored as typed and checked on the runner device. Picking a folder through a browsing dialog is out of scope for version 1: the path is typed or pasted.
- Relative working folder paths are resolved against a single projects base folder that the user declares once for the runner device.
