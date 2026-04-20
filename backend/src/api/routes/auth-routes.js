import { requireFields, parseJsonBody } from '../validation.js'
import { ApiError } from '../errors.js'
import { verifyPassword } from '../../auth/password.js'
import { quoteSql } from '../../db/client.js'

export function registerAuthRoutes(addRoute, deps) {
  addRoute('GET', '/api/v1/workspaces/default', async () => {
    const rows = deps.db.query('SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1;')
    const workspace = rows[0]
    if (!workspace) {
      throw new ApiError(404, 'NOT_FOUND', 'No workspace found')
    }
    return { status: 200, body: workspace }
  })

  addRoute('POST', '/api/v1/auth/login', async (ctx) => {
    const body = await parseJsonBody(ctx.req)
    requireFields(body, ['username', 'password'])

    const users = deps.db.query(
      `SELECT id, username, role, password_hash FROM users WHERE username=${quoteSql(body.username)} AND is_active=1 LIMIT 1;`
    )
    const user = users[0]
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      deps.services.securityEvents.log('login_failure', {
        sourceIp: ctx.req.socket.remoteAddress,
        metadata: { username: body.username },
      })
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
    }

    deps.db.exec(`UPDATE users SET last_login_at=${quoteSql(new Date().toISOString())} WHERE id=${quoteSql(user.id)};`)
    const session = deps.services.session.create(user.id)
    deps.services.securityEvents.log('login_success', {
      userId: user.id,
      sourceIp: ctx.req.socket.remoteAddress,
    })

    return {
      status: 200,
      body: {
        session_token: session.token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
    }
  })

  addRoute('POST', '/api/v1/auth/logout', async (ctx) => {
    const auth = ctx.req.headers.authorization || ''
    if (auth.startsWith('Bearer ')) {
      deps.services.session.revoke(auth.slice('Bearer '.length))
    }
    return { status: 204, body: null }
  })
}
