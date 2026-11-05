import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { ApiError } from '../api/errors.js'
import { quoteSql } from '../db/client.js'

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
      // Remember what the live database knows that the old file cannot: the highest record version any
      // client may hold, and the backup list itself (the snapshot row was created after the file).
      const liveMaxVersion = Number(db.query(`SELECT COALESCE(MAX(version), 0) AS v FROM shared_records WHERE workspace_id=${quoteSql(workspaceId)};`)[0]?.v ?? 0)
      const liveSnapshots = db.query(`SELECT * FROM backup_snapshots WHERE workspace_id=${quoteSql(workspaceId)};`)
      copyFileSync(snapshot.storage_path, db.dbPath)
      // A restore must reach every device, including the one that made the change being undone: versions
      // go forward past anything a client holds and updated_at moves to now so incremental pulls see them.
      db.exec(`UPDATE shared_records SET version = version + ${liveMaxVersion + 1}, updated_at=${quoteSql(new Date().toISOString())} WHERE workspace_id=${quoteSql(workspaceId)};`)
      for (const row of liveSnapshots) {
        db.exec(`INSERT OR REPLACE INTO backup_snapshots (id, workspace_id, status, storage_path, checksum, created_by_user_id, created_at, restored_at)
          VALUES (${quoteSql(row.id)}, ${quoteSql(row.workspace_id)}, ${quoteSql(row.status)}, ${quoteSql(row.storage_path)}, ${quoteSql(row.checksum)}, ${quoteSql(row.created_by_user_id)}, ${quoteSql(row.created_at)}, ${quoteSql(row.restored_at)});`)
      }
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
