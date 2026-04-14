import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { ApiError } from '../api/errors.js'

export function createBackupService({ backupSnapshotRepo, db, securityEvents }) {
  function backupRootFromDbPath(dbPath) {
    return resolve(dirname(dbPath), 'backups')
  }

  return {
    createSnapshot({ workspaceId, userId }) {
      const backupRoot = backupRootFromDbPath(db.dbPath)
      mkdirSync(backupRoot, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const destination = resolve(backupRoot, `${basename(db.dbPath)}.${stamp}.bak`)
      copyFileSync(db.dbPath, destination)
      const snapshot = backupSnapshotRepo.create({
        workspaceId,
        storagePath: destination,
        userId,
      })
      securityEvents.log('config_change', {
        userId,
        workspaceId,
        metadata: { action: 'backup_created', backup_id: snapshot.id },
      })
      return snapshot
    },

    listSnapshots(workspaceId) {
      return {
        items: backupSnapshotRepo.list(workspaceId),
      }
    },

    restoreSnapshot({ workspaceId, backupId, userId }) {
      const snapshot = backupSnapshotRepo.getById(workspaceId, backupId)
      if (!snapshot) throw new ApiError(404, 'NOT_FOUND', 'Backup snapshot not found')
      if (!existsSync(snapshot.storage_path)) {
        throw new ApiError(410, 'BACKUP_MISSING', 'Backup file no longer exists')
      }
      copyFileSync(snapshot.storage_path, db.dbPath)
      const restored = backupSnapshotRepo.markRestored(workspaceId, backupId)
      securityEvents.log('config_change', {
        userId,
        workspaceId,
        metadata: { action: 'backup_restored', backup_id: backupId },
      })
      return restored
    },
  }
}
