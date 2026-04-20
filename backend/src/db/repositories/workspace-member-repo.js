import { quoteSql } from '../client.js'

export function createWorkspaceMemberRepo(db) {
  return {
    getMembership(workspaceId, userId) {
      const rows = db.query(
        `SELECT * FROM workspace_members WHERE workspace_id=${quoteSql(workspaceId)} AND user_id=${quoteSql(userId)} LIMIT 1;`
      )
      return rows[0] || null
    },
  }
}
