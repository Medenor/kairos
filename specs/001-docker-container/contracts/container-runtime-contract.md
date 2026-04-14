# Contract: Container Runtime Interface

## Purpose

Define the operator-facing runtime contract for starting and validating the Kairos container artifact across local and self-hosted environments.

## Artifact Contract

- The artifact is a version-identifiable container image.
- Each release provides an immutable tag for deployment and rollback.
- The artifact must run as a standalone container without requiring a companion backend service.

## Startup Contract

- Required inputs:
  - Image reference (repository + immutable tag)
  - Port mapping from host to container service port
- Optional inputs:
  - Runtime environment variables documented by the release
  - Host resource limits and restart policy
- Expected behavior:
  - Container process starts without interactive setup.
  - Service endpoint becomes reachable once startup completes.
  - Missing required inputs produce clear startup failure feedback.

## Health Contract

- Readiness signal:
  - Indicates when service is ready to receive traffic.
  - Must be available to operators through documented check behavior.
- Liveness signal:
  - Indicates continued service viability during runtime.
- Failure semantics:
  - Health-check failures must map to actionable operator diagnostics where possible.

## Configuration Contract

- Configuration values are provided by operator-managed infrastructure at runtime.
- Configuration schema must define:
  - Required keys
  - Optional keys
  - Expected value formats
- Invalid configuration must fail fast at startup or return explicit warnings consistent with documented behavior.

## Portability Contract

- Same image artifact must run across development, staging, production, and self-hosted environments.
- Environment-specific behavior changes must be configuration-driven, not artifact-driven.
- Supported host architectures must be explicitly documented per release.

## Security and Privacy Contract

- Container packaging must preserve existing local-first quota behavior.
- No new external transmission of quota data is introduced by default.
- Added runtime dependencies must be justified and documented in release notes or planning artifacts.
