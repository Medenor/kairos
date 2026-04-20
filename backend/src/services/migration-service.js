import { ApiError } from '../api/errors.js'
import { mapLocalStorageImport } from './localstorage-import-mapper.js'

export function createMigrationService({ migrationJobRepo, sharedRecordService }) {
  return {
    run({ workspaceId, userId, idempotencyKey, payload }) {
      const existing = migrationJobRepo.getByIdempotencyKey(workspaceId, idempotencyKey)
      if (existing) {
        return existing
      }

      const mapped = mapLocalStorageImport(payload)
      const job = migrationJobRepo.create({
        workspaceId,
        userId,
        sourceDeviceId: payload.source_device_id,
        idempotencyKey,
        status: 'running',
        totalRecords: mapped.records.length + mapped.errors.length,
        migratedRecords: 0,
        skippedRecords: 0,
        failedRecords: mapped.errors.length,
        errorReport: mapped.errors,
      })

      let migrated = 0
      let skipped = 0
      const errors = [...mapped.errors]

      for (const record of mapped.records) {
        try {
          const existingRecord = sharedRecordService.list(workspaceId).items.find(
            (item) => item.record_type === record.recordType && item.logical_key === record.logicalKey
          )
          if (existingRecord) {
            skipped += 1
            continue
          }
          sharedRecordService.create({
            workspaceId,
            userId,
            recordType: record.recordType,
            logicalKey: record.logicalKey,
            payload: record.payload,
          })
          migrated += 1
        } catch (error) {
          errors.push({ logical_key: record.logicalKey, message: error.message })
        }
      }

      const failed = errors.length
      const status = failed > 0 ? (migrated > 0 ? 'partial' : 'failed') : 'completed'
      return migrationJobRepo.update(workspaceId, job.id, {
        status,
        completed_at: new Date().toISOString(),
        migrated_records: migrated,
        skipped_records: skipped,
        failed_records: failed,
        error_report: errors,
      })
    },

    getStatus(workspaceId, jobId) {
      const job = migrationJobRepo.getById(workspaceId, jobId)
      if (!job) throw new ApiError(404, 'NOT_FOUND', 'Migration job not found')
      return job
    },
  }
}
