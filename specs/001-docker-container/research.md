# Research: Docker Container Packaging

## Decision 1: Use a multi-stage container build

- Decision: Build static assets in a Node.js builder stage, then serve only built assets from a minimal runtime stage.
- Rationale: Separates build tooling from runtime, reduces runtime image size, and improves operational security by removing build dependencies from final image.
- Alternatives considered:
  - Single-stage image with Node.js and source code included: rejected due to larger image and broader attack surface.
  - Runtime-only image with prebuilt assets committed to repository: rejected because it couples release flow to manual artifact management.

## Decision 2: Treat runtime configuration as explicit startup contract

- Decision: Define and document required runtime inputs (port binding, immutable image tag, optional environment variables) as a formal container runtime contract.
- Rationale: Clear operator-facing contract directly supports self-hosted deployment consistency and lowers setup failure rates.
- Alternatives considered:
  - Implicit defaults without explicit contract: rejected because it increases ambiguity and troubleshooting effort.
  - Environment-specific deployment docs only: rejected because it fragments expectations across environments.

## Decision 3: Expose a deterministic health signal

- Decision: Provide an explicit health endpoint/health check behavior in the container so readiness can be validated consistently.
- Rationale: Aligns with spec requirement for actionable startup verification and supports operators in both simple and managed hosting environments.
- Alternatives considered:
  - Rely only on container process status: rejected because process-level "running" does not confirm service readiness.
  - Manual browser check only: rejected as non-automatable and inconsistent for server operations.

## Decision 4: Keep deployment scope to standalone container runtime

- Decision: Limit this feature to portable container packaging and operational docs, excluding orchestration manifests (for example Kubernetes/Compose bundles) from v1 scope.
- Rationale: Matches requested "deploy anywhere including self-hosted" goal while keeping implementation bounded and quick to verify.
- Alternatives considered:
  - Include orchestration templates immediately: rejected due to increased scope and maintenance burden.
  - Restrict to local development container only: rejected because it does not satisfy self-hosted deployment outcomes.

## Decision 5: Preserve privacy-by-default behavior in containerized deployment

- Decision: Containerization must not introduce outbound telemetry or external quota-state persistence beyond existing app behavior.
- Rationale: Maintains constitution principle for local-first quota data and avoids user trust regressions.
- Alternatives considered:
  - Add remote operational analytics by default: rejected due to privacy and dependency impact.
  - Add mandatory backend for runtime config delivery: rejected because it violates static-deploy and minimal-dependency constraints.
