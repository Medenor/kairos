// Stored shapes written by the fixed-provider build (features 001 to 006), as static literals.
// Test only. Generated once from the unmodified code; never regenerate from current code.
// Used to prove that legacy data is read-only, kept byte-for-byte and never applied (FR-022).

export const LEGACY_STATE = {
  "claude": {
    "weekly": 70,
    "__ts_weekly": null,
    "slot5h": 40,
    "__ts_slot5h": null,
    "__last_reset_date": null
  },
  "chatgpt": {
    "codex_remaining": 75,
    "__ts_codex_remaining": null,
    "codex_5h": 60,
    "__ts_codex_5h": null,
    "__last_reset_date": null
  },
  "copilot": {
    "monthly": 20,
    "__ts_monthly": null,
    "__last_reset_date": null
  },
  "openrouter": {
    "credits": 10,
    "__ts_credits": null,
    "__last_reset_date": null
  },
  "kilocode": {
    "credits": 8,
    "__ts_credits": null,
    "__last_reset_date": null
  }
}

export const LEGACY_POLICY_V1 = {
  "schemaVersion": 1,
  "services": {
    "claude": {
      "surplusEnabled": false,
      "reservePct": 20,
      "windowDays": 2,
      "autoRunEnabled": false,
      "disclosuresAckAt": null
    },
    "chatgpt": {
      "surplusEnabled": false,
      "reservePct": 20,
      "windowDays": 2,
      "autoRunEnabled": false,
      "disclosuresAckAt": null
    }
  },
  "protectedHours": [],
  "costPct": {
    "small": 3,
    "medium": 8,
    "large": 15
  },
  "thresholds": {
    "freshnessHours": 12,
    "sessionMaxAgeHours": 5,
    "sessionMinRoomPct": 30,
    "maxRunMinutes": 60,
    "evalIntervalMinutes": 15
  },
  "projectsBaseFolder": null
}

export const LEGACY_SNAPSHOT_V1 = {
  "schemaVersion": 1,
  "workspaceId": "local",
  "weekKey": "2026-W10",
  "weekStartDate": "2026-03-02",
  "weekEndDate": "2026-03-08",
  "capturedAt": "2026-03-04T10:00:00.000Z",
  "services": {
    "claude": {
      "serviceId": "claude",
      "serviceName": "Claude",
      "capturedServiceMeta": {
        "serviceId": "claude",
        "serviceName": "Claude",
        "color": "#378ADD",
        "note": "Everything disabled when weekly or 5h slot limit is reached",
        "flags": [
          "token-intensive",
          "premium LLM",
          "multi-purpose"
        ]
      },
      "lastResetDate": null,
      "quotas": {
        "weekly": {
          "quotaId": "weekly",
          "label": "Weekly quota",
          "type": "consumed_pct",
          "value": 70,
          "currency": null,
          "consumedPct": 70,
          "subnote": null
        },
        "slot5h": {
          "quotaId": "slot5h",
          "label": "5h slot (current)",
          "type": "consumed_pct",
          "value": 40,
          "currency": null,
          "consumedPct": 40,
          "subnote": null
        }
      }
    },
    "chatgpt": {
      "serviceId": "chatgpt",
      "serviceName": "ChatGPT",
      "capturedServiceMeta": {
        "serviceId": "chatgpt",
        "serviceName": "ChatGPT",
        "color": "#1D9E75",
        "note": "Main chat always active — only Codex is rate-limited",
        "flags": [
          "generalist",
          "token-efficient",
          "chat always available"
        ]
      },
      "lastResetDate": null,
      "quotas": {
        "codex_remaining": {
          "quotaId": "codex_remaining",
          "label": "Weekly quota — remaining",
          "type": "remaining_pct",
          "value": 75,
          "currency": null,
          "consumedPct": 25,
          "subnote": "Codex only"
        },
        "codex_5h": {
          "quotaId": "codex_5h",
          "label": "5h slot (current) — remaining",
          "type": "remaining_pct",
          "value": 60,
          "currency": null,
          "consumedPct": 40,
          "subnote": "Codex only"
        }
      }
    },
    "copilot": {
      "serviceId": "copilot",
      "serviceName": "GitHub Copilot",
      "capturedServiceMeta": {
        "serviceId": "copilot",
        "serviceName": "GitHub Copilot",
        "color": "#7F77DD",
        "note": "CI/CD disabled if exhausted, IDE completion stays active",
        "flags": [
          "per-request",
          "not per-token",
          "CI/CD integrated"
        ]
      },
      "lastResetDate": null,
      "quotas": {
        "monthly": {
          "quotaId": "monthly",
          "label": "Monthly quota",
          "type": "consumed_pct",
          "value": 20,
          "currency": null,
          "consumedPct": 20,
          "subnote": null
        }
      }
    },
    "openrouter": {
      "serviceId": "openrouter",
      "serviceName": "OpenRouter",
      "capturedServiceMeta": {
        "serviceId": "openrouter",
        "serviceName": "OpenRouter",
        "color": "#D85A30",
        "note": "Decreasing balance — manual top-up",
        "flags": [
          "pay-as-you-go",
          "API",
          "diverse models"
        ]
      },
      "lastResetDate": null,
      "quotas": {
        "credits": {
          "quotaId": "credits",
          "label": "Remaining balance",
          "type": "currency",
          "value": 10,
          "currency": "$",
          "consumedPct": 20,
          "subnote": null
        }
      }
    },
    "kilocode": {
      "serviceId": "kilocode",
      "serviceName": "Kilocode",
      "capturedServiceMeta": {
        "serviceId": "kilocode",
        "serviceName": "Kilocode",
        "color": "#BA7517",
        "note": "Decreasing balance — manual top-up",
        "flags": [
          "pay-as-you-go",
          "API",
          "IDE integrated"
        ]
      },
      "lastResetDate": null,
      "quotas": {
        "credits": {
          "quotaId": "credits",
          "label": "Remaining balance",
          "type": "currency",
          "value": 8,
          "currency": "$",
          "consumedPct": 20,
          "subnote": null
        }
      }
    }
  }
}

export const LEGACY_RUN = {
  "id": "run-legacy-1",
  "ideaId": "idea-legacy-1",
  "serviceId": "claude",
  "ideaSnapshot": {
    "text": "Tidy the README",
    "context": "",
    "workingFolder": null,
    "resolvedFolder": null,
    "contentVersion": 1
  },
  "mode": "auto",
  "cycleKey": "claude:2026-03-09",
  "startedAt": "2026-03-07T22:00:00.000Z",
  "endedAt": "2026-03-07T22:20:00.000Z",
  "status": "completed",
  "failureReason": null,
  "decisionInputs": {
    "rulesetVersion": 1
  },
  "estimatedCostPct": 5,
  "output": "done",
  "truncated": false,
  "proposal": null,
  "localRunDir": null
}

export const LEGACY_CYCLE = {
  "serviceId": "claude",
  "resetDate": "2026-03-09",
  "lastWeeklyRemainingPct": 42,
  "readAt": "2026-03-08T09:00:00.000Z"
}

export const LEGACY_IDEA_LAUNCHED = {
  "id": "idea-legacy-1",
  "text": "Tidy the README",
  "context": "",
  "workingFolder": null,
  "priority": "normal",
  "size": "small",
  "status": "launched_manually",
  "contentVersion": 1,
  "approvalRequested": true,
  "order": 1,
  "createdAt": "2026-03-01T08:00:00.000Z",
  "updatedAt": "2026-03-07T22:00:00.000Z",
  "serviceId": "claude",
  "resultDecision": null,
  "lastRunId": "run-legacy-1"
}

export const LEGACY_RUNNER_CONFIG_V1 = {
  "schemaVersion": 1,
  "deviceId": "device-legacy",
  "deviceName": "legacy-device",
  "workspaceId": "ws-legacy",
  "apiBase": "http://localhost:8888/api/v1",
  "allowServices": [
    "claude"
  ]
}
