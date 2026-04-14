# US2 Verification Results

Date: 2026-04-14  
Story: US2 - Deploy on Self-Hosted Infrastructure

## Executed Checks

1. `scripts/docker/run-selfhosted.sh 0.1.0`
2. `docker restart kairos`
3. `curl -fsS http://127.0.0.1:80/healthz`
4. `tests/integration/docker/us2-selfhosted-health.sh 0.1.0`

## Outcome

- Self-hosted run: Pass
- Restart behavior: Pass
- Post-restart health: Pass
- Health test script: Pass

Result: **PASS**
