import { randomBytes } from 'node:crypto'
import { quoteSql } from '../db/client.js'

export function createSessionService(db, { ttlSeconds }) {
  function create(userId) {
    const token = randomBytes(32).toString('hex')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

    db.exec(`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (${quoteSql(token)}, ${quoteSql(userId)}, ${quoteSql(now.toISOString())}, ${quoteSql(expiresAt.toISOString())});
    `)

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    }
  }

  function revoke(token) {
    db.exec(`
      UPDATE sessions SET revoked_at = ${quoteSql(new Date().toISOString())}
      WHERE token = ${quoteSql(token)} AND revoked_at IS NULL;
    `)
  }

  function verify(token) {
    const rows = db.query(`
      SELECT token, user_id, expires_at, revoked_at
      FROM sessions
      WHERE token = ${quoteSql(token)}
      LIMIT 1;
    `)

    const session = rows[0]
    if (!session) return null
    if (session.revoked_at) return null
    if (new Date(session.expires_at).getTime() <= Date.now()) return null
    return session
  }

  return {
    create,
    revoke,
    verify,
  }
}
