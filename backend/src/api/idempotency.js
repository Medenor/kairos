import { randomUUID } from 'node:crypto'
import { quoteSql } from '../db/client.js'
import { ApiError } from './errors.js'

export function createIdempotencyMiddleware(db) {
  return {
    read(workspaceId, endpoint, keyValue) {
      const rows = db.query(`
        SELECT response_body
        FROM idempotency_keys
        WHERE workspace_id=${quoteSql(workspaceId)}
          AND endpoint=${quoteSql(endpoint)}
          AND key_value=${quoteSql(keyValue)}
        LIMIT 1;
      `)
      const row = rows[0]
      if (!row) return null
      return row.response_body ? JSON.parse(row.response_body) : null
    },
    write(workspaceId, endpoint, keyValue, responseBody) {
      db.exec(`
        INSERT INTO idempotency_keys (id, workspace_id, endpoint, key_value, response_body, created_at)
        VALUES (
          ${quoteSql(randomUUID())},
          ${quoteSql(workspaceId)},
          ${quoteSql(endpoint)},
          ${quoteSql(keyValue)},
          ${quoteSql(JSON.stringify(responseBody))},
          ${quoteSql(new Date().toISOString())}
        )
        ON CONFLICT(workspace_id, endpoint, key_value)
        DO UPDATE SET response_body=excluded.response_body;
      `)
    },
    requireKey(ctx) {
      const key = ctx.req.headers['idempotency-key']
      if (!key) throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required')
      return String(key)
    },
  }
}
