import { requireAuth } from '../../auth/middleware.js'
import { ApiError } from '../errors.js'

function requireAdminMembership(deps, workspaceId, userId) {
  const membership = deps.repos.workspaceMember.getMembership(workspaceId, userId)
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace')
  if (!['admin', 'write'].includes(membership.permission)) {
    throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions')
  }
}

export function registerBackupRoutes(addRoute, deps) {
  addRoute('POST', '/api/v1/workspaces/:workspaceId/backups', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    requireAdminMembership(deps, ctx.params.workspaceId, auth.user.id)
    const snapshot = deps.services.backup.createSnapshot({
      workspaceId: ctx.params.workspaceId,
      userId: auth.user.id,
    })
    return { status: 202, body: snapshot }
  })

  addRoute('GET', '/api/v1/workspaces/:workspaceId/backups', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    requireAdminMembership(deps, ctx.params.workspaceId, auth.user.id)
    return { status: 200, body: deps.services.backup.listSnapshots(ctx.params.workspaceId) }
  })

  addRoute('POST', '/api/v1/workspaces/:workspaceId/backups/:backupId/restore', async (ctx) => {
    const auth = requireAuth({ ...ctx, services: deps.services, db: deps.db })
    requireAdminMembership(deps, ctx.params.workspaceId, auth.user.id)
    const restored = deps.services.backup.restoreSnapshot({
      workspaceId: ctx.params.workspaceId,
      backupId: ctx.params.backupId,
      userId: auth.user.id,
    })
    return { status: 202, body: restored }
  })
}
