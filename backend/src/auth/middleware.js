import { ApiError } from '../api/errors.js'
import { quoteSql } from '../db/client.js'

export function requireAuth(ctx) {
  const auth = ctx.req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token')
  }

  const token = auth.slice('Bearer '.length)
  const session = ctx.services.session.verify(token)
  if (!session) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired session')
  }

  const users = ctx.db.query(
    `SELECT id, username, role, is_active FROM users WHERE id=${quoteSql(session.user_id)} LIMIT 1;`
  )
  const user = users[0]
  if (!user || !Number(user.is_active)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'User not active')
  }

  return {
    token,
    session,
    user,
  }
}
