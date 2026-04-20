import { randomUUID } from 'node:crypto'
import { quoteSql } from '../client.js'

export function createRecordRevisionRepo(db) {
  return {
    create({
      recordId,
      workspaceId,
      previousVersion,
      newVersion,
      changeSource = 'api_write',
      changeSummary,
      userId,
    }) {
      db.exec(`
        INSERT INTO record_revisions (
          id, record_id, workspace_id, previous_version, new_version, change_source, change_summary, created_by_user_id, created_at
        ) VALUES (
          ${quoteSql(randomUUID())},
          ${quoteSql(recordId)},
          ${quoteSql(workspaceId)},
          ${quoteSql(previousVersion)},
          ${quoteSql(newVersion)},
          ${quoteSql(changeSource)},
          ${quoteSql(changeSummary)},
          ${quoteSql(userId)},
          ${quoteSql(new Date().toISOString())}
        );
      `)
    },
  }
}
