import { randomUUID } from 'node:crypto'
import { quoteSql } from '../client.js'

function normalize(row) {
  if (!row) return null
  return {
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : {},
    version: Number(row.version),
  }
}

export function createSharedRecordRepo(db) {
  return {
    list(workspaceId, since = null) {
      const where = [`workspace_id=${quoteSql(workspaceId)}`, 'deleted_at IS NULL']
      if (since) where.push(`updated_at > ${quoteSql(since)}`)
      const rows = db.query(`
        SELECT * FROM shared_records
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at ASC;
      `)
      return rows.map(normalize)
    },

    getById(workspaceId, recordId) {
      const rows = db.query(`
        SELECT * FROM shared_records
        WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(recordId)}
        LIMIT 1;
      `)
      return normalize(rows[0])
    },

    getByLogicalKey(workspaceId, recordType, logicalKey) {
      const rows = db.query(`
        SELECT * FROM shared_records
        WHERE workspace_id=${quoteSql(workspaceId)}
          AND record_type=${quoteSql(recordType)}
          AND logical_key=${quoteSql(logicalKey)}
          AND deleted_at IS NULL
        LIMIT 1;
      `)
      return normalize(rows[0])
    },

    create({ workspaceId, recordType, logicalKey, payload, userId }) {
      const id = randomUUID()
      const now = new Date().toISOString()
      db.exec(`
        INSERT INTO shared_records (id, workspace_id, record_type, logical_key, payload, version, updated_by_user_id, updated_at)
        VALUES (
          ${quoteSql(id)},
          ${quoteSql(workspaceId)},
          ${quoteSql(recordType)},
          ${quoteSql(logicalKey)},
          ${quoteSql(JSON.stringify(payload))},
          1,
          ${quoteSql(userId)},
          ${quoteSql(now)}
        );
      `)
      return this.getById(workspaceId, id)
    },

    update({ workspaceId, recordId, payload, version, userId }) {
      const now = new Date().toISOString()
      db.exec(`
        UPDATE shared_records
        SET payload=${quoteSql(JSON.stringify(payload))},
            version=${quoteSql(version)},
            updated_by_user_id=${quoteSql(userId)},
            updated_at=${quoteSql(now)}
        WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(recordId)};
      `)
      return this.getById(workspaceId, recordId)
    },

    softDelete({ workspaceId, recordId }) {
      db.exec(`
        UPDATE shared_records
        SET deleted_at=${quoteSql(new Date().toISOString())}
        WHERE workspace_id=${quoteSql(workspaceId)} AND id=${quoteSql(recordId)};
      `)
    },
  }
}
