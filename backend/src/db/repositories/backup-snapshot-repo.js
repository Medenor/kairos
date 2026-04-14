import { randomUUID, createHash } from 'node:crypto'
import { quoteSql } from '../client.js'

function normalize(row) {
  if (!row) return null
  return row
}

export function createBackupSnapshotRepo(db) {
  return {
    list(workspaceId) {
      return db
        .query(
          `SELECT * FROM backup_snapshots WHERE workspace_id=${quoteSql(workspaceId)} ORDER BY created_at DESC;`
        )
        .map(normalize)
    },

    create({ workspaceId, storagePath, userId, status = 'created' }) {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const checksum = createHash('sha256').update(`${storagePath}:${createdAt}`).digest('hex')
      db.exec(`
        INSERT INTO backup_snapshots (id, workspace_id, status, storage_path, checksum, created_by_user_id, created_at)
        VALUES (
          ${quoteSql(id)},
          ${quoteSql(workspaceId)},
          ${quoteSql(status)},
          ${quoteSql(storagePath)},
          ${quoteSql(checksum)},
          ${quoteSql(userId)},
          ${quoteSql(createdAt)}
        );
      `)
      return this.getById(workspaceId, id)
    },

    getById(workspaceId, backupId) {
      const rows = db.query(
        `SELECT * FROM backup_snapshots WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(backupId)} LIMIT 1;`
      )
      return normalize(rows[0])
    },

    markRestored(workspaceId, backupId) {
      db.exec(`
        UPDATE backup_snapshots
        SET status='restored', restored_at=${quoteSql(new Date().toISOString())}
        WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(backupId)};
      `)
      return this.getById(workspaceId, backupId)
    },
  }
}
