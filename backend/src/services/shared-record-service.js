import { ApiError } from '../api/errors.js'

export function createSharedRecordService({ sharedRecordRepo, recordRevisionRepo }) {
  return {
    list(workspaceId, since = null) {
      const items = sharedRecordRepo.list(workspaceId, since)
      return {
        items,
        sync_cursor: items.length ? items[items.length - 1].updated_at : new Date().toISOString(),
      }
    },

    create({ workspaceId, userId, recordType, logicalKey, payload }) {
      const existing = sharedRecordRepo.getByLogicalKey(workspaceId, recordType, logicalKey)
      if (existing) {
        throw new ApiError(409, 'DUPLICATE_LOGICAL_KEY', 'A record with this logical key already exists')
      }
      const created = sharedRecordRepo.create({ workspaceId, recordType, logicalKey, payload, userId })
      recordRevisionRepo.create({
        recordId: created.id,
        workspaceId,
        previousVersion: 0,
        newVersion: 1,
        changeSource: 'api_write',
        changeSummary: 'Record created',
        userId,
      })
      return created
    },

    update({ workspaceId, recordId, userId, expectedVersion, payload }) {
      const existing = sharedRecordRepo.getById(workspaceId, recordId)
      if (!existing || existing.deleted_at) {
        throw new ApiError(404, 'NOT_FOUND', 'Record not found')
      }
      if (Number(existing.version) !== Number(expectedVersion)) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Record version mismatch', {
          server_record: existing,
        })
      }
      const nextVersion = Number(existing.version) + 1
      const updated = sharedRecordRepo.update({
        workspaceId,
        recordId,
        payload,
        version: nextVersion,
        userId,
      })
      recordRevisionRepo.create({
        recordId: updated.id,
        workspaceId,
        previousVersion: existing.version,
        newVersion: nextVersion,
        changeSource: 'api_write',
        changeSummary: 'Record updated',
        userId,
      })
      return updated
    },

    remove({ workspaceId, recordId }) {
      sharedRecordRepo.softDelete({ workspaceId, recordId })
    },
  }
}
