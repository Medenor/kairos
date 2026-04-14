# Data Model: Docker Container Packaging

## Entity: ContainerArtifact

- Description: Versioned deployable image that contains the runnable application.
- Fields:
  - `tag` (string, required): Human- and CI-usable version identifier.
  - `build_timestamp` (datetime, required): Build completion time for traceability.
  - `source_revision` (string, required): Source revision identifier tied to artifact.
  - `supported_architectures` (list<string>, required): Supported CPU architecture targets.
  - `default_exposed_port` (integer, required): Default internal service port.
- Validation Rules:
  - `tag` must be immutable for a released artifact.
  - `supported_architectures` must contain at least one architecture.
  - `default_exposed_port` must be in valid TCP port range.
- Relationships:
  - One `ContainerArtifact` has one or more `DeploymentExecution` instances.

## Entity: RuntimeConfiguration

- Description: Operator-provided values used at container startup.
- Fields:
  - `host_port` (integer, required): Host port mapped to container service port.
  - `environment_variables` (map<string,string>, optional): Runtime overrides for service behavior.
  - `resource_limits` (object, optional): CPU/memory limits where host supports them.
  - `restart_policy` (enum, optional): Container restart behavior.
- Validation Rules:
  - `host_port` must be available on target host before startup.
  - Required environment variables must be present and non-empty.
  - Unknown configuration keys should produce warning or validation failure per contract.
- Relationships:
  - One `RuntimeConfiguration` is applied to one `DeploymentExecution`.

## Entity: DeploymentExecution

- Description: Concrete attempt to run a specific artifact in a target environment.
- Fields:
  - `environment_name` (string, required): Logical target (dev/staging/prod/self-hosted).
  - `host_identifier` (string, required): Host or node where container runs.
  - `start_time` (datetime, required): Startup initiation time.
  - `status` (enum, required): `starting | healthy | degraded | failed | stopped`.
  - `failure_reason` (string, optional): Operator-facing failure detail when status is failed.
- Validation Rules:
  - Status transitions must follow allowed state flow.
  - `failure_reason` required when status is `failed`.
- Relationships:
  - Belongs to one `ContainerArtifact`.
  - Uses one `RuntimeConfiguration`.
  - Produces one or more `HealthSignal` observations.

## Entity: HealthSignal

- Description: Readiness/liveness evidence for deployment verification.
- Fields:
  - `timestamp` (datetime, required): Observation time.
  - `signal_type` (enum, required): `readiness | liveness`.
  - `result` (enum, required): `pass | fail`.
  - `detail` (string, optional): Diagnostic note for operators.
- Validation Rules:
  - At least one successful readiness signal is required before declaring healthy.
  - Failures should include actionable detail where available.
- Relationships:
  - Belongs to one `DeploymentExecution`.

## State Transitions

`DeploymentExecution.status`:

1. `starting` -> `healthy` when readiness checks pass.
2. `starting` -> `failed` when required configuration is invalid or startup cannot complete.
3. `healthy` -> `degraded` when liveness/readiness starts failing intermittently.
4. `degraded` -> `healthy` when health checks recover.
5. `degraded` -> `failed` when recovery does not occur within operational threshold.
6. `failed` -> `starting` on operator retry/restart.
7. `healthy` or `degraded` -> `stopped` on intentional shutdown.
