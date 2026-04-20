import { randomUUID } from 'node:crypto'
import { quoteSql } from '../db/client.js'

export function createSecurityEventService(db) {
  return {
    log(eventType, { userId = null, workspaceId = null, sourceIp = null, metadata = {} } = {}) {
      const now = new Date().toISOString()
      db.exec(`
        INSERT INTO security_events (id, event_type, user_id, workspace_id, source_ip, metadata, occurred_at)
        VALUES (
          ${quoteSql(randomUUID())},
          ${quoteSql(eventType)},
          ${quoteSql(userId)},
          ${quoteSql(workspaceId)},
          ${quoteSql(sourceIp)},
          ${quoteSql(JSON.stringify(metadata))},
          ${quoteSql(now)}
        );
      `)
    },
  }
}
