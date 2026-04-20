import { randomUUID } from 'node:crypto'
import { quoteSql } from '../client.js'

function normalize(row) {
  if (!row) return null
  return {
    ...row,
    total_records: Number(row.total_records),
    migrated_records: Number(row.migrated_records),
    skipped_records: Number(row.skipped_records),
    failed_records: Number(row.failed_records),
    error_report: row.error_report ? JSON.parse(row.error_report) : [],
  }
}

export function createMigrationJobRepo(db) {
  return {
    getById(workspaceId, jobId) {
      const rows = db.query(
        `SELECT * FROM migration_jobs WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(jobId)} LIMIT 1;`
      )
      return normalize(rows[0])
    },

    getByIdempotencyKey(workspaceId, idempotencyKey) {
      const rows = db.query(
        `SELECT * FROM migration_jobs WHERE workspace_id=${quoteSql(workspaceId)} AND idempotency_key=${quoteSql(idempotencyKey)} LIMIT 1;`
      )
      return normalize(rows[0])
    },

    create({
      workspaceId,
      userId,
      sourceDeviceId,
      idempotencyKey,
      status = 'pending',
      totalRecords = 0,
      migratedRecords = 0,
      skippedRecords = 0,
      failedRecords = 0,
      errorReport = [],
    }) {
      const id = randomUUID()
      const now = new Date().toISOString()
      db.exec(`
        INSERT INTO migration_jobs (
          id, workspace_id, requested_by_user_id, source_device_id, idempotency_key, status,
          started_at, completed_at, total_records, migrated_records, skipped_records, failed_records, error_report
        ) VALUES (
          ${quoteSql(id)},
          ${quoteSql(workspaceId)},
          ${quoteSql(userId)},
          ${quoteSql(sourceDeviceId)},
          ${quoteSql(idempotencyKey)},
          ${quoteSql(status)},
          ${quoteSql(now)},
          NULL,
          ${quoteSql(totalRecords)},
          ${quoteSql(migratedRecords)},
          ${quoteSql(skippedRecords)},
          ${quoteSql(failedRecords)},
          ${quoteSql(JSON.stringify(errorReport))}
        );
      `)
      return this.getById(workspaceId, id)
    },

    update(workspaceId, jobId, patch) {
      const fields = []
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'error_report') {
          fields.push(`${key}=${quoteSql(JSON.stringify(value))}`)
        } else {
          fields.push(`${key}=${quoteSql(value)}`)
        }
      }
      if (fields.length) {
        db.exec(
          `UPDATE migration_jobs SET ${fields.join(', ')} WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(jobId)};`
        )
      }
      return this.getById(workspaceId, jobId)
    },
  }
}
