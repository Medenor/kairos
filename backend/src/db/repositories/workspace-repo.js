import { quoteSql } from '../client.js'

export function createWorkspaceRepo(db) {
  return {
    getById(workspaceId) {
      const rows = db.query(`SELECT * FROM workspaces WHERE id=${quoteSql(workspaceId)} LIMIT 1;`)
      return rows[0] || null
    },
  }
}
